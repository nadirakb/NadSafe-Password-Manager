/**
 * Recovery phrase for vault recovery without master password.
 *
 * Flow:
 *   1. Generate 32 random bytes (recovery entropy)
 *   2. Derive recovery key via HKDF(entropy, "nadsafe-recovery-v1")
 *   3. Encrypt user key with recovery key (AES-256-CBC + HMAC)
 *   4. Store wrapped user key on server; user writes down the phrase
 *
 * Phrase format: 32 bytes displayed as 8 groups of 4 hex chars (256 bits).
 * Example: a1b2c3d4 e5f6a7b8 c9d0e1f2 ...
 */

import { encryptEncString, decryptEncString, serializeEncString, parseEncString } from "./enc-string";
import type { SymKey } from "./types";
import { symKeyFromBytes } from "./types";
import { toUtf8, randomBytes } from "./utils";

const RECOVERY_INFO = "nadsafe-recovery-v1";

/** Generate recovery phrase entropy (32 bytes). */
export function generateRecoveryEntropy(): Uint8Array {
  return randomBytes(32);
}

/**
 * Encode entropy as a human-readable phrase.
 * Format: 8 groups of 4 hex chars, space-separated.
 * 32 bytes → 64 hex chars → split into 8×8 hex → display as "a1b2c3d4 ..."
 */
export function entropyToPhrase(entropy: Uint8Array): string {
  const hex = Array.from(entropy)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 8) {
    groups.push(hex.slice(i, i + 8));
  }
  return groups.join(" ");
}

/** Parse recovery phrase back to raw entropy bytes. */
export function phraseToEntropy(phrase: string): Uint8Array {
  const hex = phrase.replace(/\s+/g, "");
  if (hex.length !== 64) throw new Error("Invalid recovery phrase length");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("Recovery phrase must be hexadecimal");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Derive a 64-byte recovery symmetric key from entropy via HKDF-Expand. */
async function deriveRecoveryKey(entropy: Uint8Array): Promise<{ encKey: Uint8Array; macKey: Uint8Array }> {
  // Copy to concrete ArrayBuffer to satisfy WebCrypto strict typing
  const entropyBuf = entropy.buffer.slice(entropy.byteOffset, entropy.byteOffset + entropy.byteLength) as ArrayBuffer;
  const prk = await crypto.subtle.importKey(
    "raw",
    entropyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const infoBytes = toUtf8(RECOVERY_INFO);

  // Expand two 32-byte blocks (HKDF-Expand, T(1) and T(2))
  const block1 = new Uint8Array(infoBytes.length + 1);
  block1.set(infoBytes);
  block1[infoBytes.length] = 0x01;
  const encKey = new Uint8Array(
    await crypto.subtle.sign("HMAC", prk, block1.buffer.slice(block1.byteOffset, block1.byteOffset + block1.byteLength) as ArrayBuffer),
  ).slice(0, 32);

  const block2 = new Uint8Array(32 + infoBytes.length + 1);
  block2.set(encKey);
  block2.set(infoBytes, 32);
  block2[32 + infoBytes.length] = 0x02;
  const macKey = new Uint8Array(
    await crypto.subtle.sign("HMAC", prk, block2.buffer.slice(block2.byteOffset, block2.byteOffset + block2.byteLength) as ArrayBuffer),
  ).slice(0, 32);

  return { encKey, macKey };
}

/**
 * Wrap user key with recovery key.
 * Returns an EncString — store on server for recovery.
 */
export async function wrapUserKeyWithRecovery(
  userKey: SymKey,
  recoveryEntropy: Uint8Array,
): Promise<string> {
  const { encKey, macKey } = await deriveRecoveryKey(recoveryEntropy);
  const userKeyBytes = new Uint8Array([...userKey.encKey, ...userKey.macKey]);
  const enc = await encryptEncString(userKeyBytes, { encKey, macKey });
  return serializeEncString(enc);
}

/**
 * Unwrap user key using recovery phrase.
 * Use this during recovery flow when master password is lost.
 */
export async function unwrapUserKeyWithRecovery(
  wrappedUserKey: string,
  recoveryPhrase: string,
): Promise<SymKey> {
  const entropy = phraseToEntropy(recoveryPhrase);
  const { encKey, macKey } = await deriveRecoveryKey(entropy);
  const parsed = parseEncString(wrappedUserKey);
  const raw = await decryptEncString(parsed, { encKey, macKey });
  return symKeyFromBytes(raw);
}

export type { SymKey };
