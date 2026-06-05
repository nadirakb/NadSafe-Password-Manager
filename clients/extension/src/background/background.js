/**
 * NadSafe MV3 service worker.
 *
 * Responsibilities:
 * - Session management (auto-lock on timeout)
 * - Message relay between content scripts and popup
 * - Alarm-based vault lock
 */

const LOCK_ALARM = "nadsafe-autolock";
const DEFAULT_LOCK_MINUTES = 15;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.set({ locked: true });
  scheduleLock(DEFAULT_LOCK_MINUTES);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LOCK_ALARM) {
    lockVault();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "UNLOCK":
      chrome.storage.session.set({ locked: false });
      resetLockAlarm();
      sendResponse({ ok: true });
      break;

    case "LOCK":
      lockVault();
      sendResponse({ ok: true });
      break;

    case "GET_STATUS":
      chrome.storage.session.get(["locked"], (result) => {
        sendResponse({ locked: result.locked ?? true });
      });
      return true; // async response

    case "AUTOFILL_QUERY":
      // Content script asking for credentials for a given URL
      handleAutofillQuery(message.url).then(sendResponse);
      return true;

    default:
      sendResponse({ error: "Unknown message type" });
  }
});

function lockVault() {
  chrome.storage.session.set({ locked: true, sessionKey: null });
}

function scheduleLock(minutes) {
  chrome.alarms.create(LOCK_ALARM, { delayInMinutes: minutes });
}

function resetLockAlarm() {
  chrome.alarms.clear(LOCK_ALARM, () => {
    scheduleLock(DEFAULT_LOCK_MINUTES);
  });
}

async function handleAutofillQuery(url) {
  // TODO: query encrypted vault, decrypt matching logins for the given URL
  // Returns array of {name, username, encryptedPassword, id}
  return { matches: [] };
}
