import { describe, it, expect } from "vitest";
import {
  parseEncString,
  serializeEncString,
  encryptEncString,
  decryptEncString,
  encryptString,
  decryptString,
} from "./enc-string";
import { symKeyFromBytes } from "./types";
import { toB64 } from "./utils";

function testKey(seed = 7) {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) bytes[i] = (i * seed + 13) & 0xff;
  return symKeyFromBytes(bytes);
}

describe("parseEncString", () => {
  it("parses valid type-2 wire format", () => {
    const iv = new Uint8Array(16).fill(1);
    const ct = new Uint8Array(32).fill(2);
    const mac = new Uint8Array(32).fill(3);
    const s = `2.${toB64(iv)}|${toB64(ct)}|${toB64(mac)}`;
    const parsed = parseEncString(s);
    expect(parsed.type).toBe(2);
    expect(parsed.iv).toEqual(iv);
    expect(parsed.ct).toEqual(ct);
    expect(parsed.mac).toEqual(mac);
  });

  it("throws on missing type prefix", () => {
    expect(() => parseEncString("noprefix|here|atall")).toThrow(/type prefix/);
  });

  it("throws on unsupported type", () => {
    const iv = toB64(new Uint8Array(16));
    expect(() => parseEncString(`0.${iv}|AA==|AA==`)).toThrow(/unsupported type 0/);
    expect(() => parseEncString(`4.${iv}|AA==|AA==`)).toThrow(/unsupported type 4/);
  });

  it("throws on wrong number of parts", () => {
    expect(() => parseEncString("2.onlyonepart")).toThrow(/3 parts/);
    expect(() => parseEncString("2.a|b")).toThrow(/3 parts/);
    expect(() => parseEncString("2.a|b|c|d")).toThrow(/3 parts/);
  });

  it("throws on wrong IV length", () => {
    const badIv = toB64(new Uint8Array(8));
    const mac = toB64(new Uint8Array(32));
    expect(() => parseEncString(`2.${badIv}|AA==|${mac}`)).toThrow(/IV must be 16 bytes/);
  });

  it("throws on wrong MAC length", () => {
    const iv = toB64(new Uint8Array(16));
    const badMac = toB64(new Uint8Array(16));
    expect(() => parseEncString(`2.${iv}|AA==|${badMac}`)).toThrow(/MAC must be 32 bytes/);
  });
});

describe("serializeEncString", () => {
  it("round-trips through parseEncString", () => {
    const enc = {
      type: 2 as const,
      iv: new Uint8Array(16).fill(5),
      ct: new Uint8Array(48).fill(6),
      mac: new Uint8Array(32).fill(7),
    };
    expect(parseEncString(serializeEncString(enc))).toEqual(enc);
  });
});

describe("encryptEncString / decryptEncString", () => {
  it("round-trips a string", async () => {
    const key = testKey();
    const enc = await encryptEncString("secret vault item", key);
    const dec = await decryptEncString(enc, key);
    expect(new TextDecoder().decode(dec)).toBe("secret vault item");
  });

  it("round-trips raw bytes (e.g. a wrapped key)", async () => {
    const key = testKey();
    const payload = new Uint8Array(64);
    crypto.getRandomValues(payload);
    const enc = await encryptEncString(payload, key);
    expect(await decryptEncString(enc, key)).toEqual(payload);
  });

  it("round-trips empty string", async () => {
    const key = testKey();
    const enc = await encryptEncString("", key);
    expect((await decryptEncString(enc, key)).length).toBe(0);
  });

  it("round-trips unicode", async () => {
    const key = testKey();
    const s = "pässwörd 密码 🔐";
    const enc = await encryptEncString(s, key);
    expect(new TextDecoder().decode(await decryptEncString(enc, key))).toBe(s);
  });

  it("uses a fresh random IV per call (same plaintext → different ciphertext)", async () => {
    const key = testKey();
    const a = await encryptEncString("same", key);
    const b = await encryptEncString("same", key);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ct).not.toEqual(b.ct);
  });

  it("produces valid wire format (16-byte IV, 32-byte MAC)", async () => {
    const enc = await encryptEncString("x", testKey());
    expect(enc.type).toBe(2);
    expect(enc.iv.length).toBe(16);
    expect(enc.mac.length).toBe(32);
    expect(serializeEncString(enc)).toMatch(/^2\.[A-Za-z0-9+/=]+\|[A-Za-z0-9+/=]+\|[A-Za-z0-9+/=]+$/);
  });

  it("rejects tampered ciphertext (MAC failure)", async () => {
    const key = testKey();
    const enc = await encryptEncString("attack at dawn", key);
    enc.ct[0] ^= 0xff;
    await expect(decryptEncString(enc, key)).rejects.toThrow(/MAC verification failed/);
  });

  it("rejects tampered IV (MAC covers IV)", async () => {
    const key = testKey();
    const enc = await encryptEncString("attack at dawn", key);
    enc.iv[0] ^= 0xff;
    await expect(decryptEncString(enc, key)).rejects.toThrow(/MAC verification failed/);
  });

  it("rejects tampered MAC", async () => {
    const key = testKey();
    const enc = await encryptEncString("attack at dawn", key);
    enc.mac[31] ^= 0x01;
    await expect(decryptEncString(enc, key)).rejects.toThrow(/MAC verification failed/);
  });

  it("rejects decryption with the wrong key", async () => {
    const enc = await encryptEncString("secret", testKey(7));
    await expect(decryptEncString(enc, testKey(11))).rejects.toThrow(/MAC verification failed/);
  });
});

describe("encryptString / decryptString convenience wrappers", () => {
  it("round-trips wire-format strings", async () => {
    const key = testKey();
    const wire = await encryptString("hello world", key);
    expect(wire.startsWith("2.")).toBe(true);
    expect(await decryptString(wire, key)).toBe("hello world");
  });
});
