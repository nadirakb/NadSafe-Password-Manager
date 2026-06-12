/**
 * Vault crypto for the extension — standalone decrypt/encrypt of NadSafe ciphers.
 *
 * The web app derives the 64-byte user key from the master password and pushes
 * it to the extension (base64) on unlock. With that key the extension can read
 * (`/api/sync`) and write (`/api/ciphers`) the vault on its own — no web-app tab
 * required. No KDF runs here: only the already-derived key crosses the bridge.
 *
 * EncString — Bitwarden-compatible, type 2 only:
 *   "2.{iv_b64}|{ct_b64}|{mac_b64}"   AES-256-CBC + HMAC-SHA256 (encrypt-then-MAC)
 *
 * Ported faithfully from clients/web/src/lib/crypto/{enc-string,types,utils}.ts —
 * keep the two in sync if the wire format ever changes.
 */

/** 64-byte symmetric key split into enc (0..31) and mac (32..63). */
export interface SymKey {
  encKey: Uint8Array; // 32 bytes
  macKey: Uint8Array; // 32 bytes
}

interface EncStringParsed {
  iv: Uint8Array; // 16 bytes
  ct: Uint8Array;
  mac: Uint8Array; // 32 bytes
}

const te = new TextEncoder();
const td = new TextDecoder();

/**
 * Copy bytes into a fresh ArrayBuffer. WebCrypto wants a BufferSource, and under
 * strict TS a Uint8Array may be typed over ArrayBufferLike (possibly Shared) —
 * an ArrayBuffer is unconditionally accepted, sidestepping the variance error.
 */
function ab(u: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u.byteLength);
  new Uint8Array(out).set(u);
  return out;
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Unpack a base64-encoded 64-byte key into its enc/mac halves. */
export function symKeyFromB64(b64: string): SymKey {
  const bytes = fromB64(b64);
  if (bytes.length !== 64) throw new Error(`SymKey must be 64 bytes, got ${bytes.length}`);
  return { encKey: bytes.slice(0, 32), macKey: bytes.slice(32, 64) };
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function parseEncString(s: string): EncStringParsed {
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
  return { iv, ct, mac };
}

async function computeMac(macKey: Uint8Array, iv: Uint8Array, ct: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ab(macKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const message = new Uint8Array(iv.length + ct.length);
  message.set(iv, 0);
  message.set(ct, iv.length);
  const sig = await crypto.subtle.sign("HMAC", key, ab(message));
  return new Uint8Array(sig);
}

async function decryptEncString(enc: EncStringParsed, key: SymKey): Promise<Uint8Array> {
  const expectedMac = await computeMac(key.macKey, enc.iv, enc.ct);
  if (!constantTimeEqual(expectedMac, enc.mac)) {
    throw new Error("EncString: MAC verification failed — wrong key or tampered ciphertext");
  }
  const encKey = await crypto.subtle.importKey("raw", ab(key.encKey), "AES-CBC", false, ["decrypt"]);
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ab(enc.iv) }, encKey, ab(enc.ct));
  return new Uint8Array(ptBuf);
}

async function encryptEncString(plaintext: string, key: SymKey): Promise<EncStringParsed> {
  const data = te.encode(plaintext);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encKey = await crypto.subtle.importKey("raw", ab(key.encKey), "AES-CBC", false, ["encrypt"]);
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-CBC", iv: ab(iv) }, encKey, ab(data));
  const ct = new Uint8Array(ctBuf);
  const mac = await computeMac(key.macKey, iv, ct);
  return { iv, ct, mac };
}

/** Decrypt a single EncString field to a string (null-safe). */
export async function decryptField(encString: string | null | undefined, key: SymKey): Promise<string | null> {
  if (!encString) return null;
  const bytes = await decryptEncString(parseEncString(encString), key);
  return td.decode(bytes);
}

/** Encrypt a value to wire-format EncString. */
export async function encryptField(value: string, key: SymKey): Promise<string> {
  const enc = await encryptEncString(value, key);
  return `2.${toB64(enc.iv)}|${toB64(enc.ct)}|${toB64(enc.mac)}`;
}

// ── Cipher → autofill item ─────────────────────────────────────────────────────

const CIPHER_TYPE: Record<number, string> = { 1: "login", 2: "note", 3: "card", 4: "identity" };

export interface VaultItem {
  id: string;
  type: string;
  name: string;
  login?: { username: string; password: string; uris: string[]; totp: string | null };
}

/**
 * Decrypt one cipher from `/api/sync` into the extension's autofill shape.
 * Only login fields are unpacked — autofill needs nothing else. Mirrors the web
 * app's decryptCipher (fields encrypted directly under the user key; org ciphers
 * with their own key are skipped by the caller's try/catch).
 */
export async function decryptCipher(cipher: any, key: SymKey): Promise<VaultItem> {
  const name = (await decryptField(cipher.name, key)) ?? "(unnamed)";
  const item: VaultItem = { id: cipher.id, type: CIPHER_TYPE[cipher.type] ?? "login", name };

  if (cipher.type === 1 && cipher.login) {
    const [username, password, totp] = await Promise.all([
      decryptField(cipher.login.username, key),
      decryptField(cipher.login.password, key),
      decryptField(cipher.login.totp, key),
    ]);
    const uris = await Promise.all((cipher.login.uris ?? []).map((u: any) => decryptField(u.uri, key)));
    item.login = {
      username: username ?? "",
      password: password ?? "",
      uris: uris.filter(Boolean) as string[],
      totp,
    };
  }
  return item;
}
