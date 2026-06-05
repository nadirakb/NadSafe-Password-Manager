/**
 * EncString — Bitwarden-compatible encrypted payload format.
 *
 * Type 2: AES-256-CBC + HMAC-SHA256
 * Wire format: "2.{iv_b64}|{ct_b64}|{mac_b64}"
 * MAC covers: IV || CT (encrypt-then-MAC, no key commitment)
 */

import { toB64, fromB64, constantTimeEqual, randomBytes } from "./utils";
import type { EncStringParsed, SymKey } from "./types";

export function parseEncString(s: string): EncStringParsed {
  const dot = s.indexOf(".");
  if (dot === -1) throw new Error("EncString: missing type prefix");
  const type = parseInt(s.slice(0, dot));
  if (type !== 2) throw new Error(`EncString: unsupported type ${type}`);

  const parts = s.slice(dot + 1).split("|");
  if (parts.length !== 3) throw new Error("EncString: expected 3 parts");

  const iv = fromB64(parts[0]);
  const ct = fromB64(parts[1]);
  const mac = fromB64(parts[2]);

  if (iv.length !== 16) throw new Error("EncString: IV must be 16 bytes");
  if (mac.length !== 32) throw new Error("EncString: MAC must be 32 bytes");

  return { type: 2, iv, ct, mac };
}

export function serializeEncString(enc: EncStringParsed): string {
  return `${enc.type}.${toB64(enc.iv)}|${toB64(enc.ct)}|${toB64(enc.mac)}`;
}

/** Encrypt plaintext (bytes or string) with a 64-byte symmetric key. */
export async function encryptEncString(
  plaintext: Uint8Array | string,
  key: SymKey,
): Promise<EncStringParsed> {
  const data: Uint8Array =
    typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : new Uint8Array(plaintext);

  const iv = randomBytes(16);

  const encKey = await crypto.subtle.importKey("raw", new Uint8Array(key.encKey), "AES-CBC", false, ["encrypt"]);
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(iv) }, encKey, new Uint8Array(data));
  const ct = new Uint8Array(ctBuf);

  const mac = await computeMac(key.macKey, iv, ct);

  return { type: 2, iv, ct, mac };
}

/** Decrypt an EncString. Returns plaintext bytes. */
export async function decryptEncString(
  enc: EncStringParsed,
  key: SymKey,
): Promise<Uint8Array> {
  // Verify MAC first (encrypt-then-MAC)
  const expectedMac = await computeMac(key.macKey, enc.iv, enc.ct);
  if (!constantTimeEqual(expectedMac, enc.mac)) {
    throw new Error("EncString: MAC verification failed — wrong key or tampered ciphertext");
  }

  const encKey = await crypto.subtle.importKey("raw", new Uint8Array(key.encKey), "AES-CBC", false, ["decrypt"]);
  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: new Uint8Array(enc.iv) },
    encKey,
    new Uint8Array(enc.ct),
  );
  return new Uint8Array(ptBuf);
}

async function computeMac(
  macKey: Uint8Array,
  iv: Uint8Array,
  ct: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(macKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = new Uint8Array(iv.length + ct.length);
  message.set(iv, 0);
  message.set(ct, iv.length);
  const sig = await crypto.subtle.sign("HMAC", key, message);
  return new Uint8Array(sig);
}

/** Convenience: encrypt a string and return wire-format string. */
export async function encryptString(s: string, key: SymKey): Promise<string> {
  return serializeEncString(await encryptEncString(s, key));
}

/** Convenience: decrypt wire-format string to plaintext string. */
export async function decryptString(enc: string, key: SymKey): Promise<string> {
  const parsed = parseEncString(enc);
  const bytes = await decryptEncString(parsed, key);
  return new TextDecoder().decode(bytes);
}
