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

import { useEffect, useCallback, useRef } from "react";
import { useVaultStore } from "../stores/vault";
import { getSessionUserKey } from "../stores/session";
import { checkExtensionInstalled, pushItemsToExtension } from "../lib/extension-bridge";

export function useExtensionAutoPush(): void {
  const items = useVaultStore((s) => s.items);
  const lastSynced = useVaultStore((s) => s.lastSynced);
  const installed = useRef<boolean | null>(null);

  const push = useCallback(async () => {
    if (!getSessionUserKey()) return; // vault locked — nothing to share
    const current = useVaultStore.getState().items;
    if (current.length === 0) return;

    if (installed.current === null) {
      installed.current = await checkExtensionInstalled();
    }
    if (installed.current) void pushItemsToExtension(current);
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
