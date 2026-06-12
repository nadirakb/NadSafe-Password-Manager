/**
 * Bridge: push vault data to NadSafe browser extension via postMessage.
 * The extension's content script relays messages to the background service worker.
 *
 * Protocol: window.postMessage({ source: "nadsafe-webapp", type, payload })
 * Response: window.addEventListener("message") with source="nadsafe-extension"
 */

import type { VaultItem } from "../stores/vault";

const WEBAPP_SOURCE = "nadsafe-webapp";
const EXT_SOURCE = "nadsafe-extension";

/** Check if NadSafe extension is installed by pinging its content script. */
export function checkExtensionInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 1000);

    function onMessage(event: MessageEvent) {
      if (
        event.data?.source === EXT_SOURCE &&
        event.data?.type === "PONG"
      ) {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(true);
      }
    }

    window.addEventListener("message", onMessage);
    // Post to our own origin only — the content-script bridge runs in this page.
    window.postMessage({ source: WEBAPP_SOURCE, type: "PING" }, window.location.origin);
  });
}

/**
 * Push decrypted vault items to the extension for autofill. Fire-and-forget:
 * the content-script bridge forwards them to the background worker with no ack.
 * Targets our own origin so the credential payload never leaves this page.
 */
export function pushItemsToExtension(items: VaultItem[]): Promise<boolean> {
  window.postMessage(
    { source: WEBAPP_SOURCE, type: "PUSH_ITEMS", payload: { items } },
    window.location.origin,
  );
  return Promise.resolve(true);
}

export interface ExtensionSession {
  /** Base64 of the 64-byte user key (enc||mac). */
  userKey: string;
  accessToken: string;
  /** Absolute server origin the extension fetches from. */
  serverUrl: string;
  email?: string;
}

/**
 * Push the unlocked session — user key, access token, server URL — to the
 * extension so it can read and write the vault directly from the server (sync +
 * save) without this tab open. The content-script bridge gates the message on
 * the configured web-app origin before handing it to the background worker.
 *
 * Same trust boundary as pushItemsToExtension (which already crosses plaintext
 * items): the message is posted to our own origin only and bridged in-browser.
 * No-op in the Tauri desktop shell (no content script listening).
 */
export function pushSessionToExtension(session: ExtensionSession): Promise<boolean> {
  window.postMessage(
    { source: WEBAPP_SOURCE, type: "PUSH_SESSION", payload: session },
    window.location.origin,
  );
  return Promise.resolve(true);
}

/**
 * Relay the user's PIN to the extension so the same digits unlock it — a
 * "set once" PIN shared between the web app and the extension within this
 * browser. The extension wraps its own data-encryption key under this PIN
 * locally; the PIN never reaches the server and is only sent at the moment the
 * user types it (set / change / unlock). Fire-and-forget over the same-origin
 * bridge (the content script gates it on the trusted web-app origin).
 *
 * No-op in the Tauri desktop shell (no content script listening) — desktop
 * keeps its own device-local PIN.
 */
export function pushPinToExtension(pin: string): Promise<boolean> {
  window.postMessage(
    { source: WEBAPP_SOURCE, type: "PUSH_PIN", payload: { pin } },
    window.location.origin,
  );
  return Promise.resolve(true);
}

/** Clear the extension's PIN when the user removes it in the web app. */
export function removePinFromExtension(): Promise<boolean> {
  window.postMessage(
    { source: WEBAPP_SOURCE, type: "REMOVE_PIN", payload: {} },
    window.location.origin,
  );
  return Promise.resolve(true);
}
