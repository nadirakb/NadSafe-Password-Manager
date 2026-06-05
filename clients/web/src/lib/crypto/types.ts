export type KdfType = "argon2id" | "pbkdf2";

export interface Argon2idParams {
  type: "argon2id";
  mCost: number;
  tCost: number;
  pCost: number;
}

export interface Pbkdf2Params {
  type: "pbkdf2";
  iterations: number;
}

export type KdfParams = Argon2idParams | Pbkdf2Params;

/** 64-byte symmetric key split into enc (0..31) and mac (32..63). */
export interface SymKey {
  encKey: Uint8Array; // 32 bytes
  macKey: Uint8Array; // 32 bytes
}

export function symKeyFromBytes(bytes: Uint8Array): SymKey {
  if (bytes.length !== 64) throw new Error(`SymKey must be 64 bytes, got ${bytes.length}`);
  return {
    encKey: bytes.slice(0, 32),
    macKey: bytes.slice(32, 64),
  };
}

export function symKeyToBytes(k: SymKey): Uint8Array {
  const out = new Uint8Array(64);
  out.set(k.encKey, 0);
  out.set(k.macKey, 32);
  return out;
}

/** Parsed EncString (type 2 = AES-256-CBC + HMAC-SHA256). */
export interface EncStringParsed {
  type: 2;
  iv: Uint8Array;   // 16 bytes
  ct: Uint8Array;
  mac: Uint8Array;  // 32 bytes
}
