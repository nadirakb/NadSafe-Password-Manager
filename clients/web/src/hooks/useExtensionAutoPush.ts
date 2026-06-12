/**
 * useExtensionAutoPush — keep the browser extension unlocked in step with the
 * web app.
 *
 * Whenever the vault is unlocked and has items, push them to the NadSafe
 * extension (if installed) so it unlocks automatically — no manual
 * "Push to extension" needed. Re-pushes on item changes and whenever the web
 * app tab regains focus (so returning to an active app re-arms the extension).
 *
 * Safe no-op when the extension isn't installed or the vault is locked.
 */

import { useEffect, useCallback } from "react";
import { useVaultStore } from "../stores/vault";
import { getSessionUserKey } from "../stores/session";
import { pushItemsToExtension } from "../lib/extension-bridge";

export function useExtensionAutoPush(): void {
  const items = useVaultStore((s) => s.items);
  const lastSynced = useVaultStore((s) => s.lastSynced);

  const push = useCallback(() => {
    if (!getSessionUserKey()) return; // vault locked — nothing to share
    const current = useVaultStore.getState().items;
    if (current.length === 0) return;

    // Fire-and-forget same-origin postMessage. No install check: a stale
    // "not installed" result (content script not ready on first load, or a
    // PONG slower than the 1s probe) used to latch off auto-push for the whole
    // session, forcing a manual "Push to extension" every visit. The push is a
    // harmless no-op when nothing is listening, so always send it.
    void pushItemsToExtension(current);
  }, []);

  // Push on item changes / fresh syncs.
  useEffect(() => {
    void push();
  }, [items, lastSynced, push]);

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
}
