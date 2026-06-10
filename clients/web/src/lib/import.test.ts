import { describe, it, expect, vi, beforeEach } from "vitest";
import { importBitwardenJson } from "./import";
import { createCipher, type CreateCipherRequest } from "./api/vault";
import { decryptField } from "./crypto/key-hierarchy";
import { symKeyFromBytes } from "./crypto/types";
import type { ApiClient } from "./api/client";

vi.mock("./api/vault", () => ({
  createCipher: vi.fn().mockResolvedValue({ id: "new-id" }),
}));

const mockCreateCipher = vi.mocked(createCipher);
const client = {} as ApiClient;

function userKey() {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) bytes[i] = (i * 13 + 5) & 0xff;
  return symKeyFromBytes(bytes);
}

beforeEach(() => {
  mockCreateCipher.mockClear();
  mockCreateCipher.mockResolvedValue({ id: "new-id" } as Awaited<ReturnType<typeof createCipher>>);
});

describe("importBitwardenJson input validation", () => {
  it("rejects invalid JSON", async () => {
    await expect(importBitwardenJson("not json{{{", client, userKey())).rejects.toThrow(
      /Invalid JSON/,
    );
  });

  it("rejects encrypted exports", async () => {
    const json = JSON.stringify({ encrypted: true, items: [] });
    await expect(importBitwardenJson(json, client, userKey())).rejects.toThrow(
      /Encrypted Bitwarden exports are not supported/,
    );
  });

  it("handles export with no items array", async () => {
    const result = await importBitwardenJson(JSON.stringify({ encrypted: false }), client, userKey());
    expect(result).toEqual({ imported: 0, failed: 0, errors: [] });
  });
});

describe("importBitwardenJson item mapping", () => {
  it("imports a login item with encrypted fields", async () => {
    const key = userKey();
    const json = JSON.stringify({
      encrypted: false,
      items: [
        {
          type: 1,
          name: "GitHub",
          notes: "work account",
          favorite: true,
          login: {
            username: "octocat",
            password: "hunter2",
            totp: "JBSWY3DPEHPK3PXP",
            uris: [{ uri: "https://github.com", match: null }],
          },
        },
      ],
    });

    const result = await importBitwardenJson(json, client, key);
    expect(result).toEqual({ imported: 1, failed: 0, errors: [] });
    expect(mockCreateCipher).toHaveBeenCalledTimes(1);

    const payload = mockCreateCipher.mock.calls[0][1] as CreateCipherRequest;
    expect(payload.type).toBe(1);
    expect(payload.favorite).toBe(true);
    // All sensitive fields must be EncStrings, decryptable with the user key
    expect(await decryptField(payload.name, key)).toBe("GitHub");
    expect(await decryptField(payload.notes, key)).toBe("work account");
    expect(await decryptField(payload.login?.username, key)).toBe("octocat");
    expect(await decryptField(payload.login?.password, key)).toBe("hunter2");
    expect(await decryptField(payload.login?.totp, key)).toBe("JBSWY3DPEHPK3PXP");
    expect(await decryptField(payload.login?.uris[0].uri, key)).toBe("https://github.com");
    // Nothing leaks in plaintext
    expect(JSON.stringify(payload)).not.toContain("hunter2");
    expect(JSON.stringify(payload)).not.toContain("octocat");
  });

  it("imports a secure note (type 2)", async () => {
    const json = JSON.stringify({
      encrypted: false,
      items: [{ type: 2, name: "WiFi", notes: "pass: abc", secureNote: { type: 0 } }],
    });
    const result = await importBitwardenJson(json, client, userKey());
    expect(result.imported).toBe(1);
    const payload = mockCreateCipher.mock.calls[0][1] as CreateCipherRequest;
    expect(payload.type).toBe(2);
    expect(payload.secureNote).toEqual({ type: 0 });
  });

  it("imports a card (type 3) with encrypted card fields", async () => {
    const key = userKey();
    const json = JSON.stringify({
      encrypted: false,
      items: [
        {
          type: 3,
          name: "Visa",
          card: {
            cardholderName: "J Doe",
            brand: "Visa",
            number: "4111111111111111",
            expMonth: "12",
            expYear: "2030",
            code: "123",
          },
        },
      ],
    });
    const result = await importBitwardenJson(json, client, key);
    expect(result.imported).toBe(1);
    const payload = mockCreateCipher.mock.calls[0][1] as CreateCipherRequest;
    expect(payload.type).toBe(3);
    expect(await decryptField(payload.card?.number, key)).toBe("4111111111111111");
    expect(await decryptField(payload.card?.code, key)).toBe("123");
    expect(JSON.stringify(payload)).not.toContain("4111111111111111");
  });

  it("uses '(unnamed)' for items without a name and null for absent optional fields", async () => {
    const key = userKey();
    const json = JSON.stringify({
      encrypted: false,
      items: [{ type: 1, name: "", login: {} }],
    });
    await importBitwardenJson(json, client, key);
    const payload = mockCreateCipher.mock.calls[0][1] as CreateCipherRequest;
    expect(await decryptField(payload.name, key)).toBe("(unnamed)");
    expect(payload.notes).toBeNull();
    expect(payload.login?.username).toBeNull();
    expect(payload.login?.password).toBeNull();
  });
});

describe("importBitwardenJson error handling and progress", () => {
  it("continues after per-item failures and records errors", async () => {
    mockCreateCipher
      .mockResolvedValueOnce({ id: "1" } as Awaited<ReturnType<typeof createCipher>>)
      .mockRejectedValueOnce(new Error("server says no"))
      .mockResolvedValueOnce({ id: "3" } as Awaited<ReturnType<typeof createCipher>>);

    const json = JSON.stringify({
      encrypted: false,
      items: [
        { type: 2, name: "ok-1" },
        { type: 2, name: "bad" },
        { type: 2, name: "ok-2" },
      ],
    });
    const result = await importBitwardenJson(json, client, userKey());
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual(['"bad": server says no']);
  });

  it("reports progress from 0 to total", async () => {
    const json = JSON.stringify({
      encrypted: false,
      items: [
        { type: 2, name: "a" },
        { type: 2, name: "b" },
      ],
    });
    const progress: Array<[number, number]> = [];
    await importBitwardenJson(json, client, userKey(), (done, total) => progress.push([done, total]));
    expect(progress[0]).toEqual([0, 2]);
    expect(progress[progress.length - 1]).toEqual([2, 2]);
  });
});
