/**
 * NadSafe MV3 service worker — real vault fetch + autofill.
 *
 * Message API:
 *   UNLOCK       { email, passwordHash, serverUrl } → { ok, error? }
 *   LOCK         {} → { ok }
 *   GET_STATUS   {} → { locked }
 *   AUTOFILL_QUERY { url } → { matches: [{id, name, username, password}] }
 *   GET_ITEMS    {} → { items: VaultItem[] }
 *   SYNC         {} → { ok, count }
 *
 * Firefox compat: use globalThis.browser when available (Firefox), fall back to chrome.
 */

// Polyfill: Firefox exposes `browser`, Chrome exposes `chrome`.
// Both support the same MV3 API surface for storage.session, runtime, alarms.
const ext = (typeof browser !== "undefined" ? browser : chrome);

const LOCK_ALARM = "nadsafe-autolock";
const DEFAULT_LOCK_MINUTES = 15;

// PIN quick-unlock (Proton-style). A random data-encryption key (DEK) encrypts
// the items snapshot at rest; the DEK is wrapped by a PIN-stretched key.
const PIN_ITERATIONS = 600_000; // PBKDF2-SHA256
const PIN_MAX_ATTEMPTS = 5;

// How long a submitted-but-unsaved credential may wait for the post-login
// page to load before it is discarded.
const PENDING_SAVE_TTL_MS = 45_000;

// ─── Alarm / lock ─────────────────────────────────────────────────────────────

// The trusted web-app origin (storage.local `webAppOrigin`) is deliberately
// never seeded with a default: operators must configure it in the extension
// settings, so localhost can't leak into prod. The content-script bridge
// rejects PUSH_ITEMS/PUSH_SESSION from any other origin.
ext.runtime.onInstalled.addListener(() => {
  ext.storage.session.set({ locked: true });
  scheduleLock(DEFAULT_LOCK_MINUTES);
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LOCK_ALARM) lockVault();
});

function lockVault() {
  // Clear every in-memory secret — items, DEK, and the API access token
  // (a locked vault must not keep a usable bearer token around).
  // PIN material in storage.local is kept so the user can quick-unlock; full
  // clear happens only on REMOVE_PIN / failed-attempt wipe. serverUrl stays so
  // the locked popup's "Open vault" link still works.
  ext.storage.session.set({
    locked: true,
    sessionKey: null,
    items: null,
    dek: null,
    pendingSave: null,
    accessToken: null,
    rawCiphers: null,
    encryptedUserKey: null,
  });
}

function scheduleLock(minutes) {
  ext.alarms.create(LOCK_ALARM, { delayInMinutes: minutes });
}

function resetLockAlarm() {
  ext.alarms.clear(LOCK_ALARM, () => scheduleLock(DEFAULT_LOCK_MINUTES));
}

// ─── Message handler ──────────────────────────────────────────────────────────

// Any of these messages means the vault is actively in use — push back the
// 15-minute idle lock so active use never locks mid-session.
// GET_STATUS is deliberately excluded: it is a passive poll (popup open, content
// script init) and must not keep the vault unlocked indefinitely.
const ACTIVITY_TYPES = new Set([
  "GET_ITEMS", "AUTOFILL_QUERY", "SYNC", "SAVE_CREDENTIAL", "CREATE_ALIAS",
  "SET_PIN", "UNLOCK_PIN",
]);

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (ACTIVITY_TYPES.has(message.type)) resetLockAlarm();

  switch (message.type) {
    case "UNLOCK":
      handleUnlock(message).then(sendResponse).catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;

    case "LOCK":
      lockVault();
      sendResponse({ ok: true });
      break;

    case "GET_STATUS":
      Promise.all([
        ext.storage.session.get(["locked"]),
        ext.storage.local.get(["pin"]),
      ]).then(([s, l]) => {
        sendResponse({ locked: s.locked ?? true, hasPin: !!l.pin, pinLength: l.pin?.length ?? null });
      });
      return true;

    case "AUTOFILL_QUERY":
      // Trust the sender's actual tab URL over the self-reported one — a
      // compromised page context must not be able to query another site's
      // credentials. The popup has no tab, so its explicit url is used.
      handleAutofillQuery(_sender?.tab?.url ?? message.url).then(sendResponse);
      return true;

    case "GET_ITEMS":
      handleGetItems().then(sendResponse);
      return true;

    case "SYNC":
      handleSync().then(sendResponse);
      return true;

    case "STORE_ITEMS": {
      // Web app pushes pre-decrypted items via content script bridge.
      // Remember which tab (and origin) the web app lives in, so SAVE_CREDENTIAL
      // can relay new credentials back to it for encryption + server save.
      const origin = _sender?.origin ?? (_sender?.tab?.url ? originOf(_sender.tab.url) : null);
      ext.storage.session.set({
        items: message.items,
        locked: false,
        webappTabId: _sender?.tab?.id ?? null,
        webappOrigin: origin,
      });
      // Keep the PIN-protected at-rest snapshot fresh (only when a DEK is in
      // memory, i.e. PIN was set/unlocked this session — keeps it in sync with
      // the wrapped DEK).
      refreshVaultBlob(message.items);
      sendResponse({ ok: true, count: message.items?.length ?? 0 });
      resetLockAlarm();
      break;
    }

    case "SAVE_CREDENTIAL":
      handleSaveCredential(message)
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;

    case "GET_ALIAS_CONFIG":
      ext.storage.local.get(["aliasService", "aliasApiKey"], (cfg) => {
        sendResponse({ configured: !!(cfg.aliasService && cfg.aliasApiKey), service: cfg.aliasService ?? null });
      });
      return true;

    case "SAVE_ALIAS_CONFIG":
      ext.storage.local.set({ aliasService: message.service, aliasApiKey: message.apiKey, aliasBase: message.base ?? "" }, () => {
        sendResponse({ ok: true });
      });
      return true;

    case "CREATE_ALIAS":
      handleCreateAlias(message.hostname).then(sendResponse);
      return true;

    case "SET_PIN":
      handleSetPin(message)
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;

    case "UNLOCK_PIN":
      handleUnlockPin(message)
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;

    case "REMOVE_PIN":
      handleRemovePin().then(sendResponse);
      return true;

    // Pending-save stash: a classic form submit navigates the page before the
    // content script can show the save offer, so the credential is held here
    // (memory-only session storage, short TTL, same-tab only) and re-offered
    // on the next page load in that tab.
    case "STASH_PENDING_SAVE":
      ext.storage.session.set({
        pendingSave: { ...message.payload, tabId: _sender?.tab?.id ?? null, ts: Date.now() },
      }).then(() => sendResponse({ ok: true }));
      return true;

    case "POP_PENDING_SAVE":
      ext.storage.session.get(["pendingSave"]).then(async ({ pendingSave }) => {
        await ext.storage.session.remove("pendingSave");
        const fresh =
          pendingSave &&
          Date.now() - pendingSave.ts < PENDING_SAVE_TTL_MS &&
          pendingSave.tabId != null &&
          pendingSave.tabId === _sender?.tab?.id;
        sendResponse({ pending: fresh ? pendingSave : null });
      });
      return true;

    case "CLEAR_PENDING_SAVE":
      ext.storage.session.remove("pendingSave").then(() => sendResponse({ ok: true }));
      return true;

    case "OPEN_WEBAPP":
      handleOpenWebapp()
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;

    default:
      sendResponse({ error: "Unknown message type" });
  }
});

// ─── Unlock flow ──────────────────────────────────────────────────────────────

async function handleUnlock({ email, serverUrl, accessToken, encryptedUserKey, kdfType, kdfParams }) {
  if (!accessToken || !encryptedUserKey) {
    return { ok: false, error: "Missing token or encrypted key — re-login in web app first" };
  }

  // Store token + server for API calls
  await ext.storage.session.set({
    locked: false,
    accessToken,
    serverUrl: serverUrl ?? "",
    email,
    encryptedUserKey,
    kdfType,
    kdfParams,
  });

  resetLockAlarm();

  // Trigger immediate sync
  await handleSync().catch(() => null);

  return { ok: true };
}

// ─── Sync vault ───────────────────────────────────────────────────────────────

async function handleSync() {
  const session = await ext.storage.session.get([
    "locked", "accessToken", "serverUrl",
  ]);

  if (session.locked || !session.accessToken) {
    return { ok: false, error: "Vault locked" };
  }

  try {
    const base = session.serverUrl || "";
    const res = await fetch(`${base}/api/sync?excludeDomains=true`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });

    if (!res.ok) throw new Error(`Sync HTTP ${res.status}`);
    const data = await res.json();

    // Store raw (encrypted) ciphers — decryption happens in content script
    // or popup which has access to WebCrypto and hash-wasm
    await ext.storage.session.set({ rawCiphers: data.ciphers ?? [] });

    return { ok: true, count: (data.ciphers ?? []).length };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Get cached items (already decrypted by popup) ────────────────────────────

async function handleGetItems() {
  const session = await ext.storage.session.get(["locked", "items"]);
  if (session.locked) return { items: [] };
  return { items: session.items ?? [] };
}

// ─── Save credential ─────────────────────────────────────────────────────────

// The extension holds no encryption key, so it cannot create a server cipher
// itself. Instead it relays the credential to the open NadSafe web app tab,
// which encrypts with the in-memory user key and POSTs to the server.

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

async function handleSaveCredential({ hostname, username, password }) {
  const session = await ext.storage.session.get(["locked", "webappTabId", "webappOrigin"]);
  if (session.locked) return { ok: false, error: "Vault locked" };

  const tabId = session.webappTabId;
  const expectedOrigin = session.webappOrigin;
  if (tabId == null || !expectedOrigin) {
    return { ok: false, error: 'Open NadSafe and click "Push to extension" first' };
  }

  // Verify the target tab is still the NadSafe web app before relaying the
  // plaintext credential — a tab that navigated away must not receive it.
  let tab;
  try {
    tab = await ext.tabs.get(tabId);
  } catch {
    return { ok: false, error: "NadSafe tab closed — reopen it and push again" };
  }
  if (originOf(tab?.url) !== expectedOrigin) {
    return { ok: false, error: "NadSafe tab navigated away — reopen it and push again" };
  }

  try {
    const res = await ext.tabs.sendMessage(tabId, {
      type: "WEBAPP_SAVE",
      payload: { hostname, username, password, uri: `https://${hostname}` },
    });
    if (res?.ok) return { ok: true };
    return { ok: false, error: res?.error ?? "NadSafe web app could not save" };
  } catch {
    return { ok: false, error: "NadSafe tab not reachable — reopen it and push again" };
  }
}

// Focus the existing NadSafe web-app tab, or open a fresh one at the configured
// trusted origin. The locked-vault save prompt calls this so the user has a
// one-click path to unlock: returning to the app auto-pushes the vault, which
// re-arms the extension for the pending save.
async function handleOpenWebapp() {
  const [{ webappTabId }, { webAppOrigin }] = await Promise.all([
    ext.storage.session.get(["webappTabId"]),
    ext.storage.local.get(["webAppOrigin"]),
  ]);

  if (webappTabId != null) {
    try {
      const tab = await ext.tabs.get(webappTabId);
      if (tab) {
        await ext.tabs.update(webappTabId, { active: true });
        if (tab.windowId != null) await ext.windows.update(tab.windowId, { focused: true });
        return { ok: true };
      }
    } catch { /* tab gone — fall through to open a fresh one */ }
  }

  if (!webAppOrigin) {
    return { ok: false, error: "Set the NadSafe web-app origin in the extension settings first" };
  }
  await ext.tabs.create({ url: webAppOrigin });
  return { ok: true };
}

// ─── Alias service ────────────────────────────────────────────────────────────

async function handleCreateAlias(hostname) {
  const cfg = await new Promise((resolve) => ext.storage.local.get(["aliasService", "aliasApiKey", "aliasBase"], resolve));
  if (!cfg.aliasApiKey || !cfg.aliasService) return { ok: false, error: "Alias service not configured" };

  try {
    if (cfg.aliasService === "simplelogin") {
      const res = await fetch("https://app.simplelogin.io/api/alias/random/new", {
        method: "POST",
        headers: { "Authentication": cfg.aliasApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ hostname, note: `NadSafe — ${hostname}` }),
      });
      if (!res.ok) return { ok: false, error: `SimpleLogin ${res.status}` };
      const data = await res.json();
      return { ok: true, alias: data.email };
    }

    if (cfg.aliasService === "anonaddy") {
      const base = (cfg.aliasBase ?? "").replace(/\/$/, "") || "https://app.anonaddy.com";
      const res = await fetch(`${base}/api/v1/aliases`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cfg.aliasApiKey}`,
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ description: `NadSafe — ${hostname}` }),
      });
      if (!res.ok) return { ok: false, error: `AnonAddy ${res.status}` };
      const data = await res.json();
      return { ok: true, alias: data.data?.email ?? data.email };
    }

    return { ok: false, error: "Unknown alias service" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Autofill: match URL against cached items ─────────────────────────────────

// Reduce a stored URI or page URL to a comparable hostname. Stored URIs are
// free text the user typed in the web app — they may be scheme-less
// ("github.com", "github.com/login") which `new URL()` rejects outright, or
// carry a "www." that differs from the page. Normalize both sides so neither
// quirk hides a saved login.
function normalizeHost(value) {
  if (!value) return "";
  let s = String(value).trim();
  if (!s) return "";
  // Prepend a scheme when missing so `new URL()` can parse a bare host/path.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let host;
  try { host = new URL(s).hostname.toLowerCase(); } catch { return ""; }
  return host.startsWith("www.") ? host.slice(4) : host;
}

// Same site when hostnames are equal, or one is a subdomain of the other
// (accounts.google.com ↔ google.com). The leading dot prevents
// "evil-google.com" from matching "google.com".
function hostsMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

async function handleAutofillQuery(url) {
  const session = await ext.storage.session.get(["locked", "items"]);
  if (session.locked || !session.items) return { matches: [] };

  const host = normalizeHost(url);
  if (!host) return { matches: [] };

  const matches = (session.items ?? [])
    .filter((item) => {
      if (item.type !== "login" || !item.login?.uris) return false;
      return item.login.uris.some((uri) => hostsMatch(normalizeHost(uri), host));
    })
    .map((item) => ({
      id: item.id,
      name: item.name,
      username: item.login.username ?? "",
      password: item.login.password ?? "",
    }));

  return { matches };
}

// ─── PIN quick-unlock ─────────────────────────────────────────────────────────
//
// At rest (storage.local):
//   pin       = { salt, iv, wrapped, iterations, length } — DEK wrapped by PIN key
//   vaultBlob = { iv, data }                              — items snapshot AES-GCM'd by DEK
// In memory (storage.session, cleared on lock/restart):
//   dek       = raw 32-byte data-encryption key
// All byte arrays are stored as plain number[] (structured-clone friendly).

const te = new TextEncoder();
const td = new TextDecoder();
const toU8 = (arr) => new Uint8Array(arr);
const toArr = (u8) => Array.from(u8);

function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

async function derivePinKey(pin, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", te.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function importDek(rawArr) {
  return crypto.subtle.importKey("raw", toU8(rawArr), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function aesEncrypt(key, plaintext) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { iv: toArr(iv), data: toArr(new Uint8Array(ct)) };
}

async function aesDecrypt(key, ivArr, dataArr) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toU8(ivArr) }, key, toU8(dataArr));
  return new Uint8Array(pt);
}

// Re-encrypt the at-rest session snapshot — only when a DEK is in memory (the DEK
// must stay paired with the wrapped DEK, so we never write a blob the PIN can't open).
//
// The blob holds items (autofill) + serverUrl (the "Open vault" link). The API
// accessToken is deliberately NOT persisted: the whole blob sits behind a 4-6
// digit PIN, and an offline brute force of 10^4-10^6 PINs (the attempt counter
// lives in the same storage.local and can be bypassed) must yield at most the
// snapshot — never a live bearer token. Server sync and save-relay resume on
// the next web-app push instead.
async function refreshVaultBlob(items) {
  const s = await ext.storage.session.get(["dek", "serverUrl"]);
  if (!s.dek) return;
  const dekKey = await importDek(s.dek);
  const bundle = {
    items: items ?? [],
    serverUrl: s.serverUrl ?? "",
  };
  const vaultBlob = await aesEncrypt(dekKey, te.encode(JSON.stringify(bundle)));
  await ext.storage.local.set({ vaultBlob });
}

// Decrypted vaultBlob → normalized bundle. Tolerates the legacy formats: a bare
// items array (pre-session-persistence builds) and bundles that still carry an
// accessToken (dropped on read; the next refreshVaultBlob rewrites without it).
function unwrapVaultBundle(parsed) {
  if (Array.isArray(parsed)) return { items: parsed, serverUrl: "" };
  return {
    items: parsed.items ?? [],
    serverUrl: parsed.serverUrl ?? "",
  };
}

async function handleSetPin({ pin }) {
  if (!/^(\d{4}|\d{6})$/.test(pin || "")) return { ok: false, error: "PIN must be 4 or 6 digits" };

  const session = await ext.storage.session.get(["locked", "items", "dek", "serverUrl"]);
  if (session.locked) return { ok: false, error: "Unlock the vault before setting a PIN" };

  // Reuse the in-memory DEK if present (changing PIN), else mint a fresh one.
  const dekArr = session.dek ?? toArr(randomBytes(32));
  const dekKey = await importDek(dekArr);

  // No accessToken in the bundle — see refreshVaultBlob.
  const bundle = {
    items: session.items ?? [],
    serverUrl: session.serverUrl ?? "",
  };
  const vaultBlob = await aesEncrypt(dekKey, te.encode(JSON.stringify(bundle)));

  const salt = randomBytes(16);
  const pinKey = await derivePinKey(pin, salt, PIN_ITERATIONS);
  const wrap = await aesEncrypt(pinKey, toU8(dekArr));

  await ext.storage.local.set({
    pin: { salt: toArr(salt), iv: wrap.iv, wrapped: wrap.data, iterations: PIN_ITERATIONS, length: pin.length },
    vaultBlob,
    pinAttempts: 0,
  });
  await ext.storage.session.set({ dek: dekArr });
  return { ok: true };
}

async function handleUnlockPin({ pin }) {
  const local = await ext.storage.local.get(["pin", "vaultBlob", "pinAttempts"]);
  if (!local.pin || !local.vaultBlob) return { ok: false, error: "No PIN set on this device" };

  const attempts = local.pinAttempts ?? 0;
  try {
    const pinKey = await derivePinKey(pin, toU8(local.pin.salt), local.pin.iterations);
    const dek = await aesDecrypt(pinKey, local.pin.iv, local.pin.wrapped); // throws on wrong PIN (GCM tag)
    const dekKey = await importDek(toArr(dek));
    const blobBytes = await aesDecrypt(dekKey, local.vaultBlob.iv, local.vaultBlob.data);
    const bundle = unwrapVaultBundle(JSON.parse(td.decode(blobBytes)));

    // Restore autofill items + the "Open vault" link. No accessToken at rest,
    // so server sync / save-relay wait for the next web-app push.
    await ext.storage.session.set({
      locked: false,
      items: bundle.items,
      serverUrl: bundle.serverUrl,
      dek: toArr(dek),
    });
    await ext.storage.local.set({ pinAttempts: 0 });
    resetLockAlarm();
    return { ok: true };
  } catch {
    const used = attempts + 1;
    const left = PIN_MAX_ATTEMPTS - used;
    if (left <= 0) {
      // Brute-force guard: wipe PIN material, forcing a fresh web-app push.
      await ext.storage.local.remove(["pin", "vaultBlob", "pinAttempts"]);
      return { ok: false, wiped: true, error: "Too many attempts — PIN cleared. Re-sync from the NadSafe web app." };
    }
    await ext.storage.local.set({ pinAttempts: used });
    return { ok: false, attemptsLeft: left, error: `Wrong PIN — ${left} attempt${left === 1 ? "" : "s"} left` };
  }
}

async function handleRemovePin() {
  await ext.storage.local.remove(["pin", "vaultBlob", "pinAttempts"]);
  await ext.storage.session.remove(["dek"]);
  return { ok: true };
}
