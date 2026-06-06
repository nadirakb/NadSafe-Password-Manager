/**
 * useTauriAutoLock — listen for Tauri window focus-restored event and lock vault.
 *
 * Only active when running inside Tauri desktop app (window.__TAURI_INTERNALS__ present).
 * Safe no-op in browser / extension context.
 */

import { useEffect } from "react";
import { useAuthStore } from "../stores/auth";

// Tauri 2.x runtime guard — avoids bundling tauri API in non-Tauri builds
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useTauriAutoLock(): void {
  const lock = useAuthStore((s) => s.lock);

  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    // Dynamic import so the tauri bundle is only pulled in Tauri context
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<void>("vault:focus-restored", () => {
          lock();
        }),
      )
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Silently ignore — non-Tauri build or older version
      });

    return () => {
      unlisten?.();
    };
  }, [lock]);
}
