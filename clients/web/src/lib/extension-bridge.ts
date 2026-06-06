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

type ExtMessage = {
  source: string;
  type: string;
  version?: string;
  ok?: boolean;
  error?: string;
};

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
    window.postMessage({ source: WEBAPP_SOURCE, type: "PING" }, "*");
  });
}

/** Push decrypted vault items to the extension for autofill. */
export function pushItemsToExtension(items: VaultItem[]): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 2000);

    function onMessage(event: MessageEvent<ExtMessage>) {
      if (event.data?.source === EXT_SOURCE && event.data?.type === "SESSION_RESULT") {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(event.data.ok ?? false);
      }
    }

    // Send items via PUSH_ITEMS (no auth needed — items already decrypted)
    window.postMessage({
      source: WEBAPP_SOURCE,
      type: "PUSH_ITEMS",
      payload: { items },
    }, "*");

    // Also set extension as connected
    window.addEventListener("message", onMessage);
    resolve(true); // PUSH_ITEMS is fire-and-forget
    clearTimeout(timeout);
  });
}
