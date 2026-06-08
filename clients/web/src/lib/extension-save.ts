/**
 * Receives save requests relayed from the NadSafe browser extension and
 * persists them to the vault.
 *
 * The extension holds no encryption key (zero-knowledge), so when the user
 * clicks "Add" on the extension's save prompt, the credential is relayed here —
 * to the open, unlocked web app — which encrypts it with the in-memory user key
 * and POSTs to the server. All crypto stays inside the web app.
 *
 * Protocol (window.postMessage, bridged by the extension content script):
 *   ext → web app: { source: "nadsafe-extension", type: "SAVE_REQUEST", nonce, payload: { hostname, username, password, uri } }
 *   web app → ext: { source: "nadsafe-webapp",     type: "SAVE_RESULT",  nonce, ok, error? }
 */

import { getApiClient } from "./api/client";
import { createCipher } from "./api/vault";
import { encryptField } from "./crypto/key-hierarchy";
import { decryptCipher } from "../hooks/useVaultSync";
import { getSessionUserKey } from "../stores/session";
import { useVaultStore } from "../stores/vault";
import { pushItemsToExtension } from "./extension-bridge";

const EXT_SOURCE = "nadsafe-extension";
const WEBAPP_SOURCE = "nadsafe-webapp";

interface SaveRequest {
  hostname?: string;
  username?: string;
  password?: string;
  uri?: string;
}

let initialized = false;

/** Attach the extension save-request listener. Idempotent. */
export function initExtensionSaveListener(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("message", handleMessage);
}

async function handleMessage(event: MessageEvent): Promise<void> {
  // Only accept messages this window posted to itself (the content-script relay).
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== EXT_SOURCE || data.type !== "SAVE_REQUEST") return;

  const nonce: unknown = data.nonce;
  const payload: SaveRequest = data.payload ?? {};

  const reply = (ok: boolean, error?: string) =>
    window.postMessage(
      { source: WEBAPP_SOURCE, type: "SAVE_RESULT", nonce, ok, error },
      window.location.origin,
    );

  try {
    const userKey = getSessionUserKey();
    if (!userKey) {
      reply(false, "NadSafe is locked — unlock the web app, then try again");
      return;
    }

    const { hostname, username, password, uri } = payload;
    if (!password) {
      reply(false, "No password to save");
      return;
    }

    const client = getApiClient();
    const [encName, encUser, encPass, encUri] = await Promise.all([
      encryptField(hostname || uri || "Untitled login", userKey),
      username ? encryptField(username, userKey) : Promise.resolve(null),
      encryptField(password, userKey),
      uri ? encryptField(uri, userKey) : Promise.resolve(null),
    ]);

    const created = await createCipher(client, {
      type: 1,
      name: encName,
      notes: null,
      folderId: null,
      organizationId: null,
      collectionIds: [],
      favorite: false,
      reprompt: 0,
      fields: [],
      login: {
        username: encUser,
        password: encPass,
        totp: null,
        uris: encUri ? [{ uri: encUri, match: null }] : [],
      },
    });

    // Reflect the new item in the web app store and re-push to the extension so
    // it shows up for autofill immediately, without a manual sync.
    const newItem = await decryptCipher(created, userKey);
    const store = useVaultStore.getState();
    const items = [...store.items, newItem];
    store.setItems(items);
    store.markSynced();
    void pushItemsToExtension(items);

    reply(true);
  } catch (err) {
    reply(false, err instanceof Error ? err.message : "Save failed");
  }
}
