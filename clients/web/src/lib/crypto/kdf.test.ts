import { describe, it, expect } from "vitest";
import { deriveMasterKey, deriveAuthHash, stretchMasterKey } from "./kdf";

/**
 * PBKDF2 / HKDF vectors ported from crates/crypto-core/tests/bitwarden_vectors.rs
 * so the browser crypto layer is verified against the same reference values as
 * the Rust implementation (wire compatibility across layers).
 */

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("deriveMasterKey (PBKDF2)", () => {
  it("matches 5k-iteration reference vector", async () => {
    const key = await deriveMasterKey("masterpassword", "user@example.com", {
      type: "pbkdf2",
      iterations: 5000,
    });
    expect(toHex(key)).toBe("562289f6883d1e80113da9767e2d2ecb611bec4e29ab5b3adf46cae7237f537c");
  });

  it("matches 600k-iteration reference vector (Bitwarden default)", async () => {
    const key = await deriveMasterKey("password", "user@example.com", {
      type: "pbkdf2",
      iterations: 600_000,
    });
    expect(toHex(key)).toBe("81be19a9c170df7152970ab88d3bef6de90595ed232b873a876869d68a780d68");
  });

  it("lowercases email before use as salt", async () => {
    const params = { type: "pbkdf2" as const, iterations: 5000 };
    const lower = await deriveMasterKey("masterpassword", "user@example.com", params);
    const upper = await deriveMasterKey("masterpassword", "USER@EXAMPLE.COM", params);
    expect(toHex(upper)).toBe(toHex(lower));
  });

  it("different passwords produce different keys", async () => {
    const params = { type: "pbkdf2" as const, iterations: 5000 };
    const a = await deriveMasterKey("password-a", "user@example.com", params);
    const b = await deriveMasterKey("password-b", "user@example.com", params);
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it("derives via Argon2id when requested", async () => {
    // Small params to keep the test fast; verifies the hash-wasm path works
    // and is deterministic.
    const params = { type: "argon2id" as const, mCost: 1024, tCost: 1, pCost: 1 };
    const a = await deriveMasterKey("password", "user@example.com", params);
    const b = await deriveMasterKey("password", "user@example.com", params);
    expect(a.length).toBe(32);
    expect(toHex(a)).toBe(toHex(b));
    const pbkdf2 = await deriveMasterKey("password", "user@example.com", {
      type: "pbkdf2",
      iterations: 5000,
    });
    expect(toHex(a)).not.toBe(toHex(pbkdf2));
  });
});

describe("deriveAuthHash", () => {
  it("matches 5k reference vector", async () => {
    const masterKey = await deriveMasterKey("masterpassword", "user@example.com", {
      type: "pbkdf2",
      iterations: 5000,
    });
    const authHash = await deriveAuthHash(masterKey, "masterpassword");
    expect(toHex(authHash)).toBe("76a315a2dfeca6addebd64dbb4eff6ca43b3e7ec7ac3689a2e0e776b044ed3aa");
  });

  it("matches 600k reference vector", async () => {
    const masterKey = await deriveMasterKey("password", "user@example.com", {
      type: "pbkdf2",
      iterations: 600_000,
    });
    const authHash = await deriveAuthHash(masterKey, "password");
    expect(toHex(authHash)).toBe("8c6072f953c004c637cbe3dd56063b8c296cc90847786470bd8152fa5ea37c7f");
  });

  it("differs from the master key (domain separation)", async () => {
    const masterKey = await deriveMasterKey("password", "user@example.com", {
      type: "pbkdf2",
      iterations: 5000,
    });
    const authHash = await deriveAuthHash(masterKey, "password");
    expect(toHex(authHash)).not.toBe(toHex(masterKey));
  });
});

describe("stretchMasterKey (HKDF-Expand)", () => {
  it("matches 5k reference vector", async () => {
    const masterKey = await deriveMasterKey("masterpassword", "user@example.com", {
      type: "pbkdf2",
      iterations: 5000,
    });
    const { encKey, macKey } = await stretchMasterKey(masterKey);
    expect(toHex(encKey)).toBe("142d9e9fb476c290fa5454e301756662b813edccf26420852983dc9f20b33853");
    expect(toHex(macKey)).toBe("1ea9fd1675992d9ccbbf5eead0bb45b8f044415bbe018130f483e3ee84624804");
  });

  it("matches 600k reference vector", async () => {
    const masterKey = await deriveMasterKey("password", "user@example.com", {
      type: "pbkdf2",
      iterations: 600_000,
    });
    const { encKey, macKey } = await stretchMasterKey(masterKey);
    expect(toHex(encKey)).toBe("4cd5a5f1b6326bd572de7c07a7e5674d013e404cc32077ef8f5eb4d2f5364759");
    expect(toHex(macKey)).toBe("099fa1ff37a68dda11b0de6c10d3007e3c6d0f9fcf2b6c32154a45a0e1317538");
  });

  it("produces two distinct 32-byte halves", async () => {
    const masterKey = await deriveMasterKey("pw", "a@b.com", {
      type: "pbkdf2",
      iterations: 1,
    });
    const { encKey, macKey } = await stretchMasterKey(masterKey);
    expect(encKey.length).toBe(32);
    expect(macKey.length).toBe(32);
    expect(toHex(encKey)).not.toBe(toHex(macKey));
  });
});
