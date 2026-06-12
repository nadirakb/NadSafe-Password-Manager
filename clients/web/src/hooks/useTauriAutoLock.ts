/**
 * useTauriAutoLock — lock vault after 15 minutes of user inactivity.
 *
 * Only active when running inside Tauri desktop app (window.__TAURI_INTERNALS__ present).
 * Activity resets the timer: mouse move, click, keypress, scroll, touch.
 * Safe no-op in browser / extension context.
 */

import { useEffect } from "react";
import { lockVault } from "../stores/lock";
import { isTauri } from "../lib/platform";

const INACTIVITY_MS = 15 * 60 * 1000;

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

export function useTauriAutoLock(): void {
  // Tray menu "Lock Vault" and the lock_vault command emit this event from
  // the Rust side — without a listener they would silently do nothing.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("vault:lock", lockVault).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      }),
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    function resetTimer() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(lockVault, INACTIVITY_MS);
    }

    ACTIVITY_EVENTS.forEach((ev) =>
      document.addEventListener(ev, resetTimer, { passive: true }),
    );
    resetTimer();

    return () => {
      if (timer !== null) clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((ev) => document.removeEventListener(ev, resetTimer));
    };
  }, []);
}
