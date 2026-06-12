/**
 * useVaultTimeout — auto-lock vault after a configurable period of inactivity.
 *
 * Timeout is stored in localStorage so it persists across reloads.
 * Resets on any mouse/keyboard/touch activity.
 * Setting 0 = never auto-lock.
 */

import { useEffect } from "react";
import { useAuthStore } from "../stores/auth";
import { lockVault } from "../stores/lock";

const STORAGE_KEY = "nadsafe_vault_timeout_minutes";
const DEFAULT_MINUTES = 15;

export function getVaultTimeoutMinutes(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return DEFAULT_MINUTES;
  const n = parseInt(stored, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MINUTES;
}

export function setVaultTimeoutMinutes(minutes: number): void {
  localStorage.setItem(STORAGE_KEY, String(Math.max(0, minutes)));
}

export function useVaultTimeout(): void {
  const { isAuthenticated, isLocked } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated || isLocked) return;

    const minutes = getVaultTimeoutMinutes();
    if (minutes === 0) return; // disabled

    const ms = minutes * 60 * 1000;
    let timerId: ReturnType<typeof setTimeout>;

    function reset() {
      clearTimeout(timerId);
      timerId = setTimeout(lockVault, ms);
    }

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));

    reset(); // start the timer

    return () => {
      clearTimeout(timerId);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [isAuthenticated, isLocked]);
}
