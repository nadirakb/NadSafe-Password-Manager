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
