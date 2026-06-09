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
