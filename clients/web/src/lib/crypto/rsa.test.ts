import { describe, it, expect } from "vitest";
import {
  generateRsaKeyPair,
  decryptRsaPrivateKey,
  importRsaPublicKey,
  rsaEncrypt,
  rsaDecrypt,
} from "./rsa";
import { symKeyFromBytes } from "./types";

function userKey() {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) bytes[i] = (i * 11 + 17) & 0xff;
  return symKeyFromBytes(bytes);
}

describe("RSA key pair lifecycle", () => {
  it("generates, stores encrypted, restores, and decrypts an org key", async () => {
    const key = userKey();
    const { publicKeyBase64, encryptedPrivateKey } = await generateRsaKeyPair(key);

    // Public key is plain base64 DER; private key is an EncString
    expect(publicKeyBase64).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(encryptedPrivateKey.startsWith("2.")).toBe(true);

    // Simulate org key sharing: encrypt a 64-byte org key to the member's public key
    const orgKey = new Uint8Array(64);
    crypto.getRandomValues(orgKey);
    const publicKey = await importRsaPublicKey(publicKeyBase64);
    const ciphertextB64 = await rsaEncrypt(orgKey, publicKey);

    // Member restores private key from server blob and decrypts the org key
    const privateKey = await decryptRsaPrivateKey(encryptedPrivateKey, key);
    const decrypted = await rsaDecrypt(ciphertextB64, privateKey);
    expect(decrypted).toEqual(orgKey);
  }, 30_000);

  it("rejects private key decryption with the wrong user key", async () => {
    const { encryptedPrivateKey } = await generateRsaKeyPair(userKey());
    const wrongKey = symKeyFromBytes(new Uint8Array(64).fill(0x42));
    await expect(decryptRsaPrivateKey(encryptedPrivateKey, wrongKey)).rejects.toThrow(
      /MAC verification failed/,
    );
  }, 30_000);

  it("RSA-OAEP encryption is randomized (same plaintext → different ciphertext)", async () => {
    const { publicKeyBase64 } = await generateRsaKeyPair(userKey());
    const publicKey = await importRsaPublicKey(publicKeyBase64);
    const data = new Uint8Array([1, 2, 3, 4]);
    const a = await rsaEncrypt(data, publicKey);
    const b = await rsaEncrypt(data, publicKey);
    expect(a).not.toBe(b);
  }, 30_000);
});
