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

// ─── Alarm / lock ─────────────────────────────────────────────────────────────

ext.runtime.onInstalled.addListener(() => {
  ext.storage.session.set({ locked: true });
  scheduleLock(DEFAULT_LOCK_MINUTES);
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LOCK_ALARM) lockVault();
});

function lockVault() {
  // Clear in-memory secrets. PIN material in storage.local is kept so the user
  // can quick-unlock; full clear happens only on REMOVE_PIN / failed-attempt wipe.
  ext.storage.session.set({ locked: true, sessionKey: null, items: null, dek: null });
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
const ACTIVITY_TYPES = new Set([
  "GET_STATUS", "GET_ITEMS", "AUTOFILL_QUERY", "SYNC", "SAVE_CREDENTIAL", "CREATE_ALIAS",
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
      handleAutofillQuery(message.url).then(sendResponse);
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

    default:
      sendResponse({ error: "Unknown message type" });
  }
});

// ─── Unlock flow ──────────────────────────────────────────────────────────────

async function handleUnlock({ email, passwordHash, serverUrl, accessToken, encryptedUserKey, kdfType, kdfParams }) {
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

async function handleAutofillQuery(url) {
  const session = await ext.storage.session.get(["locked", "items"]);
  if (session.locked || !session.items) return { matches: [] };

  let hostname = "";
  try { hostname = new URL(url).hostname; } catch { return { matches: [] }; }

  const matches = (session.items ?? [])
    .filter((item) => {
      if (item.type !== "login" || !item.login?.uris) return false;
      return item.login.uris.some((uri) => {
        try { return new URL(uri).hostname === hostname; } catch { return false; }
      });
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

// Re-encrypt the at-rest items snapshot — only when a DEK is in memory (the DEK
// must stay paired with the wrapped DEK, so we never write a blob the PIN can't open).
async function refreshVaultBlob(items) {
  const s = await ext.storage.session.get(["dek"]);
  if (!s.dek) return;
  const dekKey = await importDek(s.dek);
  const vaultBlob = await aesEncrypt(dekKey, te.encode(JSON.stringify(items ?? [])));
  await ext.storage.local.set({ vaultBlob });
}

async function handleSetPin({ pin }) {
  if (!/^(\d{4}|\d{6})$/.test(pin || "")) return { ok: false, error: "PIN must be 4 or 6 digits" };

  const session = await ext.storage.session.get(["locked", "items", "dek"]);
  if (session.locked) return { ok: false, error: "Unlock the vault before setting a PIN" };

  // Reuse the in-memory DEK if present (changing PIN), else mint a fresh one.
  const dekArr = session.dek ?? toArr(randomBytes(32));
  const dekKey = await importDek(dekArr);

  const vaultBlob = await aesEncrypt(dekKey, te.encode(JSON.stringify(session.items ?? [])));

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
    const itemsBytes = await aesDecrypt(dekKey, local.vaultBlob.iv, local.vaultBlob.data);
    const items = JSON.parse(td.decode(itemsBytes));

    await ext.storage.session.set({ locked: false, items, dek: toArr(dek) });
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
