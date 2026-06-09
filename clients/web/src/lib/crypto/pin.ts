/**
 * PIN quick-unlock for the desktop (Tauri) app.
 *
 * Wraps the user's symmetric key with a PIN-stretched key (PBKDF2-SHA256 +
 * AES-GCM, native WebCrypto) and stores the blob in localStorage, so the app can
 * be unlocked with a 4/6-digit PIN instead of the full master password.
 *
 * Security: a low-entropy PIN protects the vault key at rest, so the blob is
 * brute-forceable if exfiltrated (XSS, or local disk access). Mitigated by a
 * heavy KDF (600k iterations) and a 5-attempt wipe that forces a full
 * master-password unlock. Available on both the Tauri desktop shell and the
 * browser web app as an opt-in convenience — the user enables it explicitly in
 * Settings, accepting the at-rest tradeoff for quick unlock after a browser
 * restart (same model as Bitwarden's optional PIN unlock).
 */

import { symKeyToBytes, symKeyFromBytes, type SymKey } from "./types";

const BLOB_KEY = "nadsafe_pin";
const ATTEMPTS_KEY = "nadsafe_pin_attempts";
const ITERATIONS = 600_000;
const MAX_ATTEMPTS = 5;

interface PinBlob {
  salt: number[];
  iv: number[];
  wrapped: number[];
  iterations: number;
  length: number;
}

// Let inference produce Uint8Array<ArrayBuffer> (WebCrypto's BufferSource);
// an explicit `: Uint8Array` annotation widens to ArrayBufferLike and is rejected.
const toU8 = (a: number[]) => new Uint8Array(a);
const toArr = (u: Uint8Array): number[] => Array.from(u);

function randomBytes(n: number) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

async function derivePinKey(pin: string, salt: BufferSource, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function pinIsSet(): boolean {
  return localStorage.getItem(BLOB_KEY) !== null;
}

export function getPinLength(): number | null {
  const raw = localStorage.getItem(BLOB_KEY);
  if (!raw) return null;
  try { return (JSON.parse(raw) as PinBlob).length ?? null; } catch { return null; }
}

export function removePin(): void {
  localStorage.removeItem(BLOB_KEY);
  localStorage.removeItem(ATTEMPTS_KEY);
}

export async function setPin(pin: string, userKey: SymKey): Promise<void> {
  if (!/^(\d{4}|\d{6})$/.test(pin)) throw new Error("PIN must be 4 or 6 digits");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await derivePinKey(pin, salt, ITERATIONS);
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(symKeyToBytes(userKey))),
  );
  const blob: PinBlob = {
    salt: toArr(salt), iv: toArr(iv), wrapped: toArr(wrapped),
    iterations: ITERATIONS, length: pin.length,
  };
  localStorage.setItem(BLOB_KEY, JSON.stringify(blob));
  localStorage.removeItem(ATTEMPTS_KEY);
}

export interface PinUnlockError extends Error {
  attemptsLeft?: number;
  wiped?: boolean;
}

export async function unlockWithPin(pin: string): Promise<SymKey> {
  const raw = localStorage.getItem(BLOB_KEY);
  if (!raw) throw new Error("No PIN set on this device");
  const blob = JSON.parse(raw) as PinBlob;
  const attempts = Number(localStorage.getItem(ATTEMPTS_KEY) ?? "0");

  try {
    const key = await derivePinKey(pin, toU8(blob.salt), blob.iterations);
    const bytes = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: toU8(blob.iv) }, key, toU8(blob.wrapped)),
    );
    localStorage.removeItem(ATTEMPTS_KEY);
    return symKeyFromBytes(bytes); // throws if wrong length (corrupt blob)
  } catch {
    const used = attempts + 1;
    const left = MAX_ATTEMPTS - used;
    const err = new Error(
      left <= 0
        ? "Too many attempts — PIN cleared. Unlock with your master password."
        : `Wrong PIN — ${left} attempt${left === 1 ? "" : "s"} left`,
    ) as PinUnlockError;
    if (left <= 0) { removePin(); err.wiped = true; }
    else { localStorage.setItem(ATTEMPTS_KEY, String(used)); err.attemptsLeft = left; }
    throw err;
  }
}
