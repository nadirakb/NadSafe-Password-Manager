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

// ─── Alarm / lock ─────────────────────────────────────────────────────────────

ext.runtime.onInstalled.addListener(() => {
  ext.storage.session.set({ locked: true });
  scheduleLock(DEFAULT_LOCK_MINUTES);
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LOCK_ALARM) lockVault();
});

function lockVault() {
  ext.storage.session.set({ locked: true, sessionKey: null, items: null });
}

function scheduleLock(minutes) {
  ext.alarms.create(LOCK_ALARM, { delayInMinutes: minutes });
}

function resetLockAlarm() {
  ext.alarms.clear(LOCK_ALARM, () => scheduleLock(DEFAULT_LOCK_MINUTES));
}

// ─── Message handler ──────────────────────────────────────────────────────────

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "UNLOCK":
      handleUnlock(message).then(sendResponse).catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;

    case "LOCK":
      lockVault();
      sendResponse({ ok: true });
      break;

    case "GET_STATUS":
      ext.storage.session.get(["locked"], (result) => {
        sendResponse({ locked: result.locked ?? true });
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

    case "STORE_ITEMS":
      // Web app pushes pre-decrypted items via content script bridge
      ext.storage.session.set({ items: message.items, locked: false });
      sendResponse({ ok: true, count: message.items?.length ?? 0 });
      resetLockAlarm();
      break;

    case "SAVE_CREDENTIAL":
      handleSaveCredential(message).then(sendResponse);
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

async function handleSaveCredential({ hostname, username, password }) {
  const session = await ext.storage.session.get(["locked", "items"]);
  if (session.locked) return { ok: false, error: "Vault locked" };

  const newItem = {
    id: `local-${Date.now()}`,
    type: "login",
    name: hostname,
    login: {
      username: username ?? "",
      password: password ?? "",
      uris: [`https://${hostname}`],
      totp: null,
    },
    _local: true, // not yet synced to server
  };

  const items = [...(session.items ?? []), newItem];
  await ext.storage.session.set({ items });

  // Persist locally so it survives popup closes (but not browser restart)
  const local = await new Promise((r) => ext.storage.local.get(["pendingItems"], r));
  const pending = [...(local.pendingItems ?? []), newItem];
  await new Promise((r) => ext.storage.local.set({ pendingItems: pending }, r));

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
