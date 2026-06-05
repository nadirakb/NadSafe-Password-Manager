/**
 * Full key hierarchy — login flow from master password to decrypted vault key.
 *
 * Flow:
 *   1. masterKey  = KDF(password, email, kdfParams)
 *   2. authHash   = PBKDF2(masterKey, password, 1)        → sent to server
 *   3. stretchedKey = HKDF-Expand(masterKey, enc+mac)     → wraps user key
 *   4. userKey    = AES-CBC-decrypt(encryptedUserKey, stretchedKey)
 *   5. vault items = AES-CBC-decrypt(encryptedField, userKey)
 */

import { deriveMasterKey, deriveAuthHash, stretchMasterKey } from "./kdf";
import {
  parseEncString,
  decryptEncString,
  encryptEncString,
  serializeEncString,
} from "./enc-string";
import { randomBytes } from "./utils";
import type { KdfParams, SymKey } from "./types";
import { symKeyFromBytes } from "./types";

export interface LoginKeyMaterial {
  masterKey: Uint8Array;
  authHash: Uint8Array;     // base64-encoded for the server
  encKey: Uint8Array;       // stretched enc half
  macKey: Uint8Array;       // stretched mac half
}

/**
 * Derive all key material needed for login.
 * Call this during: initial login, account creation, master-password change.
 */
export async function deriveLoginKeys(
  password: string,
  email: string,
  kdfParams: KdfParams,
): Promise<LoginKeyMaterial> {
  const masterKey = await deriveMasterKey(password, email, kdfParams);
  const authHash = await deriveAuthHash(masterKey, password);
  const { encKey, macKey } = await stretchMasterKey(masterKey);
  return { masterKey, authHash, encKey, macKey };
}

/** Generate a fresh random user symmetric key (64 random bytes). */
export function generateUserKey(): Uint8Array {
  return randomBytes(64);
}

/** Wrap the user key with the stretched master key (for registration / key rotation). */
export async function wrapUserKey(
  userKeyBytes: Uint8Array,
  stretchedKey: { encKey: Uint8Array; macKey: Uint8Array },
): Promise<string> {
  const enc = await encryptEncString(userKeyBytes, stretchedKey);
  return serializeEncString(enc);
}

/** Unwrap the encrypted user key from the server using stretched master key. */
export async function unwrapUserKey(
  encryptedUserKey: string,
  stretchedKey: { encKey: Uint8Array; macKey: Uint8Array },
): Promise<SymKey> {
  const parsed = parseEncString(encryptedUserKey);
  const raw = await decryptEncString(parsed, stretchedKey);
  return symKeyFromBytes(raw);
}

/** Decrypt a single vault field EncString with the user key. */
export async function decryptField(
  encString: string | null | undefined,
  userKey: SymKey,
): Promise<string | null> {
  if (!encString) return null;
  const parsed = parseEncString(encString);
  const bytes = await decryptEncString(parsed, userKey);
  return new TextDecoder().decode(bytes);
}

/** Encrypt a vault field with the user key. */
export async function encryptField(
  value: string,
  userKey: SymKey,
): Promise<string> {
  const enc = await encryptEncString(value, userKey);
  return serializeEncString(enc);
}
