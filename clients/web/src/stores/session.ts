/**
 * In-memory session store — holds crypto material that must never be persisted.
 * Cleared on lock/logout/reload.
 */

import type { SymKey } from "../lib/crypto/types";

let _userKey: SymKey | null = null;
let _rsaPrivateKey: CryptoKey | null = null;

export function setSessionUserKey(key: SymKey): void {
  _userKey = key;
}

export function getSessionUserKey(): SymKey | null {
  return _userKey;
}

export function setSessionRsaKey(key: CryptoKey): void {
  _rsaPrivateKey = key;
}

export function getSessionRsaKey(): CryptoKey | null {
  return _rsaPrivateKey;
}

export function clearSessionKey(): void {
  if (_userKey) {
    _userKey.encKey.fill(0);
    _userKey.macKey.fill(0);
    _userKey = null;
  }
  _rsaPrivateKey = null;
}
