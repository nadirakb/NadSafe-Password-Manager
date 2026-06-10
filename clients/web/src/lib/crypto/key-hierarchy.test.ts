import { describe, it, expect } from "vitest";
import {
  deriveLoginKeys,
  generateUserKey,
  wrapUserKey,
  unwrapUserKey,
  encryptField,
  decryptField,
} from "./key-hierarchy";
import { symKeyFromBytes } from "./types";

const KDF = { type: "pbkdf2" as const, iterations: 5000 };
const EMAIL = "user@example.com";
const PASSWORD = "masterpassword";

describe("deriveLoginKeys", () => {
  it("returns all four key components with correct sizes", async () => {
    const keys = await deriveLoginKeys(PASSWORD, EMAIL, KDF);
    expect(keys.masterKey.length).toBe(32);
    expect(keys.authHash.length).toBe(32);
    expect(keys.encKey.length).toBe(32);
    expect(keys.macKey.length).toBe(32);
  });

  it("is deterministic for same inputs", async () => {
    const a = await deriveLoginKeys(PASSWORD, EMAIL, KDF);
    const b = await deriveLoginKeys(PASSWORD, EMAIL, KDF);
    expect(a.masterKey).toEqual(b.masterKey);
    expect(a.authHash).toEqual(b.authHash);
    expect(a.encKey).toEqual(b.encKey);
    expect(a.macKey).toEqual(b.macKey);
  });

  it("authHash differs from masterKey (server never sees vault key material)", async () => {
    const keys = await deriveLoginKeys(PASSWORD, EMAIL, KDF);
    expect(keys.authHash).not.toEqual(keys.masterKey);
    expect(keys.encKey).not.toEqual(keys.masterKey);
  });
});

describe("generateUserKey", () => {
  it("returns 64 random bytes", () => {
    const key = generateUserKey();
    expect(key.length).toBe(64);
    expect(generateUserKey()).not.toEqual(key);
  });
});

describe("wrapUserKey / unwrapUserKey", () => {
  it("survives a full wrap → unwrap cycle (registration → login)", async () => {
    const { encKey, macKey } = await deriveLoginKeys(PASSWORD, EMAIL, KDF);
    const userKeyBytes = generateUserKey();

    const wrapped = await wrapUserKey(userKeyBytes, { encKey, macKey });
    expect(wrapped.startsWith("2.")).toBe(true);

    const unwrapped = await unwrapUserKey(wrapped, { encKey, macKey });
    expect(unwrapped.encKey).toEqual(userKeyBytes.slice(0, 32));
    expect(unwrapped.macKey).toEqual(userKeyBytes.slice(32, 64));
  });

  it("rejects unwrapping with wrong password's stretched key", async () => {
    const right = await deriveLoginKeys(PASSWORD, EMAIL, KDF);
    const wrong = await deriveLoginKeys("wrong-password", EMAIL, KDF);
    const wrapped = await wrapUserKey(generateUserKey(), right);
    await expect(unwrapUserKey(wrapped, wrong)).rejects.toThrow(/MAC verification failed/);
  });
});

describe("encryptField / decryptField", () => {
  function userKey() {
    const bytes = new Uint8Array(64);
    for (let i = 0; i < 64; i++) bytes[i] = (i * 3 + 1) & 0xff;
    return symKeyFromBytes(bytes);
  }

  it("round-trips vault field values", async () => {
    const key = userKey();
    for (const value of ["my-username", "p@ssw0rd!", "https://example.com", "long note ".repeat(100)]) {
      const enc = await encryptField(value, key);
      expect(await decryptField(enc, key)).toBe(value);
    }
  });

  it("decryptField returns null for null/undefined/empty input", async () => {
    const key = userKey();
    expect(await decryptField(null, key)).toBeNull();
    expect(await decryptField(undefined, key)).toBeNull();
    expect(await decryptField("", key)).toBeNull();
  });

  it("rejects field encrypted with a different user key", async () => {
    const enc = await encryptField("secret", userKey());
    const otherBytes = new Uint8Array(64).fill(0xab);
    const other = symKeyFromBytes(otherBytes);
    await expect(decryptField(enc, other)).rejects.toThrow(/MAC verification failed/);
  });
});

describe("end-to-end key hierarchy (password → vault field)", () => {
  it("registration + login + vault decrypt flow", async () => {
    // Registration: derive keys, generate + wrap user key
    const reg = await deriveLoginKeys(PASSWORD, EMAIL, KDF);
    const userKeyBytes = generateUserKey();
    const wrappedKey = await wrapUserKey(userKeyBytes, reg);

    // Encrypt a vault item with the user key
    const userKey = symKeyFromBytes(userKeyBytes);
    const encName = await encryptField("GitHub login", userKey);

    // Fresh login from password only (server stores wrappedKey + encName)
    const login = await deriveLoginKeys(PASSWORD, EMAIL, KDF);
    const restoredKey = await unwrapUserKey(wrappedKey, login);
    expect(await decryptField(encName, restoredKey)).toBe("GitHub login");
  });
});
