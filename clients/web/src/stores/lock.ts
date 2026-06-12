/**
 * Single place that defines what "lock" and "logout" mean.
 *
 * Locking must drop every piece of decrypted material: the in-memory user/RSA
 * keys (session.ts) AND the decrypted vault items in the zustand store —
 * leaving items in the store after lock keeps plaintext passwords in JS memory
 * and shows them to whoever unlocks next.
 *
 * clearVault() resets lastSynced, so VaultPage re-syncs on the next unlock.
 */

import { useAuthStore } from "./auth";
import { useVaultStore } from "./vault";
import { clearSessionKey } from "./session";

/** Lock the vault: wipe keys + decrypted items, keep the auth session. */
export function lockVault(): void {
  clearSessionKey();
  useVaultStore.getState().clearVault();
  useAuthStore.getState().lock();
}

/** Full sign-out: wipe keys + decrypted items + auth/tokens. */
export function logoutAndClear(): void {
  clearSessionKey();
  useVaultStore.getState().clearVault();
  useAuthStore.getState().logout();
}
