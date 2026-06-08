/**
 * useTauriAutoLock — lock vault after 15 minutes of user inactivity.
 *
 * Only active when running inside Tauri desktop app (window.__TAURI_INTERNALS__ present).
 * Activity resets the timer: mouse move, click, keypress, scroll, touch.
 * Safe no-op in browser / extension context.
 */

import { useEffect } from "react";
import { useAuthStore } from "../stores/auth";

const INACTIVITY_MS = 15 * 60 * 1000;

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useTauriAutoLock(): void {
  const lock = useAuthStore((s) => s.lock);

  useEffect(() => {
    if (!isTauri()) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    function resetTimer() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(lock, INACTIVITY_MS);
    }

    ACTIVITY_EVENTS.forEach((ev) =>
      document.addEventListener(ev, resetTimer, { passive: true }),
    );
    resetTimer();

    return () => {
      if (timer !== null) clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((ev) => document.removeEventListener(ev, resetTimer));
    };
  }, [lock]);
}
