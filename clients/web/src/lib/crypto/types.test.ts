import { describe, it, expect } from "vitest";
import { symKeyFromBytes, symKeyToBytes } from "./types";

describe("symKeyFromBytes", () => {
  it("splits 64 bytes into enc (0..31) and mac (32..63)", () => {
    const bytes = new Uint8Array(64);
    for (let i = 0; i < 64; i++) bytes[i] = i;
    const key = symKeyFromBytes(bytes);
    expect(key.encKey.length).toBe(32);
    expect(key.macKey.length).toBe(32);
    expect(key.encKey[0]).toBe(0);
    expect(key.encKey[31]).toBe(31);
    expect(key.macKey[0]).toBe(32);
    expect(key.macKey[31]).toBe(63);
  });

  it("throws on wrong length", () => {
    expect(() => symKeyFromBytes(new Uint8Array(32))).toThrow(/64 bytes/);
    expect(() => symKeyFromBytes(new Uint8Array(63))).toThrow(/64 bytes/);
    expect(() => symKeyFromBytes(new Uint8Array(65))).toThrow(/64 bytes/);
    expect(() => symKeyFromBytes(new Uint8Array(0))).toThrow(/64 bytes/);
  });

  it("copies, not views — mutating input does not change key", () => {
    const bytes = new Uint8Array(64);
    const key = symKeyFromBytes(bytes);
    bytes[0] = 99;
    expect(key.encKey[0]).toBe(0);
  });
});

describe("symKeyToBytes", () => {
  it("round-trips with symKeyFromBytes", () => {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    expect(symKeyToBytes(symKeyFromBytes(bytes))).toEqual(bytes);
  });
});
