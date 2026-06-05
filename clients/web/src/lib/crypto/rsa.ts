/**
 * RSA-2048-OAEP-SHA256 key operations for org key sharing.
 *
 * Private key is stored server-side encrypted with the user's symmetric key.
 * Org symmetric keys are RSA-encrypted to each member's public key.
 */

import { toB64, fromB64 } from "./utils";
import { encryptEncString, decryptEncString, parseEncString, serializeEncString } from "./enc-string";
import type { SymKey } from "./types";

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

export interface RsaKeyPairExport {
  /** Base64-encoded DER SubjectPublicKeyInfo (sent to server in plaintext). */
  publicKeyBase64: string;
  /** EncString of PKCS#8 private key, encrypted with user's symmetric key. */
  encryptedPrivateKey: string;
}

/** Generate RSA-2048 key pair. Private key is AES-encrypted with userSymKey. */
export async function generateRsaKeyPair(userSymKey: SymKey): Promise<RsaKeyPairExport> {
  const keyPair = await crypto.subtle.generateKey(RSA_PARAMS, true, ["encrypt", "decrypt"]);

  const [pubDer, privDer] = await Promise.all([
    crypto.subtle.exportKey("spki", keyPair.publicKey),
    crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  ]);

  const privBytes = new Uint8Array(privDer as ArrayBuffer);
  const enc = await encryptEncString(privBytes, userSymKey);

  return {
    publicKeyBase64: toB64(new Uint8Array(pubDer as ArrayBuffer)),
    encryptedPrivateKey: serializeEncString(enc),
  };
}

/** Decrypt the stored RSA private key using the user's symmetric key. */
export async function decryptRsaPrivateKey(
  encryptedPrivateKey: string,
  userSymKey: SymKey,
): Promise<CryptoKey> {
  const parsed = parseEncString(encryptedPrivateKey);
  const privDer = await decryptEncString(parsed, userSymKey);

  return crypto.subtle.importKey(
    "pkcs8",
    new Uint8Array(privDer) as unknown as ArrayBuffer,
    RSA_PARAMS,
    false,
    ["decrypt"],
  );
}

/** Import a base64 public key for encrypting org keys to members. */
export async function importRsaPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  const der = fromB64(publicKeyBase64);
  return crypto.subtle.importKey(
    "spki",
    der as unknown as ArrayBuffer,
    RSA_PARAMS,
    false,
    ["encrypt"],
  );
}

/** RSA-OAEP-SHA256 encrypt bytes (e.g. org key) to a member's public key. */
export async function rsaEncrypt(data: Uint8Array, publicKey: CryptoKey): Promise<string> {
  const enc = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    data as unknown as ArrayBuffer,
  );
  return toB64(new Uint8Array(enc));
}

/** RSA-OAEP-SHA256 decrypt bytes using the session RSA private key. */
export async function rsaDecrypt(ciphertextBase64: string, privateKey: CryptoKey): Promise<Uint8Array> {
  const ct = fromB64(ciphertextBase64);
  const pt = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    ct as unknown as ArrayBuffer,
  );
  return new Uint8Array(pt);
}
