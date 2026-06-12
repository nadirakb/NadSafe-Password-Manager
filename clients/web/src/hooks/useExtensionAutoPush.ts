/**
 * useExtensionAutoPush — keep the browser extension in step with the web app.
 *
 * Two things are pushed to the NadSafe extension (if installed) whenever the
 * vault is unlocked:
 *   1. The session — user key + access token + server URL — so the extension can
 *      sync and save against the server on its own, with this tab closed.
 *   2. The decrypted items — instant autofill data without a server round-trip.
 *
 * Re-pushes on item changes, token refresh, and whenever the web app tab regains
 * focus (so returning to an active app re-arms the extension).
 *
 * Safe no-op when the extension isn't installed or the vault is locked.
 */

import { useEffect, useCallback } from "react";
import { useVaultStore } from "../stores/vault";
import { useAuthStore } from "../stores/auth";
import { getSessionUserKey } from "../stores/session";
import { pushItemsToExtension, pushSessionToExtension } from "../lib/extension-bridge";
import { symKeyToBytes, toB64 } from "../lib/crypto";

/**
 * Backend URL the extension should fetch directly. Its service worker can't use
 * the web app's dev proxy, so resolve the real API origin:
 *   - an explicit non-same-origin serverUrl the user logged in with wins
 *     (deployed server, or a backend typed into the login form);
 *   - in dev, the proxied backend (VITE_SERVER_URL, or its :8000 default) so the
 *     extension hits the API directly and keeps working with the :5173 dev
 *     server down;
 *   - in prod, the page origin (app + API are same-origin).
 * MV3 host_permissions let the worker fetch these cross-origin without CORS.
 */
function resolveBackendUrl(authServerUrl: string): string {
  const origin = window.location.origin;
  if (authServerUrl && authServerUrl !== origin) return authServerUrl;
  const devBackend =
    (import.meta.env.VITE_SERVER_URL as string | undefined) ||
    (import.meta.env.DEV ? "http://localhost:8000" : undefined);
  return devBackend || origin;
}

export function useExtensionAutoPush(): void {
  const items = useVaultStore((s) => s.items);
  const lastSynced = useVaultStore((s) => s.lastSynced);
  const accessToken = useAuthStore((s) => s.accessToken);

  const push = useCallback(() => {
    const userKey = getSessionUserKey();
    if (!userKey) return; // vault locked — nothing to share

    // Hand the extension the session so it can pull/decrypt/save standalone.
    // Push the real backend URL (not the dev-proxy origin) so the extension's
    // service worker reaches the API directly — see resolveBackendUrl.
    const auth = useAuthStore.getState();
    if (auth.accessToken) {
      void pushSessionToExtension({
        userKey: toB64(symKeyToBytes(userKey)),
        accessToken: auth.accessToken,
        serverUrl: resolveBackendUrl(auth.serverUrl),
        email: auth.user?.email,
      });
    }

    // Fire-and-forget same-origin postMessage. No install check: a stale
    // "not installed" result (content script not ready on first load, or a
    // PONG slower than the 1s probe) used to latch off auto-push for the whole
    // session, forcing a manual "Push to extension" every visit. The push is a
    // harmless no-op when nothing is listening, so always send it.
    const current = useVaultStore.getState().items;
    if (current.length > 0) void pushItemsToExtension(current);
  }, []);

  // Push on item changes / fresh syncs / token refresh.
  useEffect(() => {
    void push();
  }, [items, lastSynced, accessToken, push]);

  // Re-push when the user returns to the web app tab.
  useEffect(() => {
    const onFocus = () => void push();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [push]);

  // Push on demand: the extension popup's "Connect" flow asks this page to push
  // its session the moment the user pairs an origin (the content script relays
  // REQUEST_PUSH same-origin). No secret crosses in — the request just triggers
  // the normal push, whose payload still goes only to our own origin.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      if (e.data?.source !== "nadsafe-extension" || e.data?.type !== "REQUEST_PUSH") return;
      void push();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [push]);
}
