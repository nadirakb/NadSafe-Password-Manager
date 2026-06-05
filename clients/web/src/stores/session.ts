/**
 * In-memory session store — holds the decrypted user key.
 * Never persisted to disk/storage. Cleared on lock/logout.
 *
 * Using a module-level variable (not Zustand) so the key bytes
 * never enter React's state diffing and aren't serialized.
 */

import type { SymKey } from "../lib/crypto/types";

let _userKey: SymKey | null = null;

export function setSessionUserKey(key: SymKey): void {
  _userKey = key;
}

export function getSessionUserKey(): SymKey | null {
  return _userKey;
}

export function clearSessionKey(): void {
  if (_userKey) {
    _userKey.encKey.fill(0);
    _userKey.macKey.fill(0);
    _userKey = null;
  }
}
