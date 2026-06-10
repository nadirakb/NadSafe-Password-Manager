import { describe, it, expect } from "vitest";
import { toB64, fromB64, toUtf8, fromUtf8, randomBytes, constantTimeEqual, wipe } from "./utils";

describe("toB64 / fromB64", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    expect(fromB64(toB64(bytes))).toEqual(bytes);
  });

  it("round-trips empty array", () => {
    expect(fromB64(toB64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  it("encodes known value", () => {
    // "Man" → "TWFu" (classic RFC 4648 example)
    expect(toB64(new Uint8Array([77, 97, 110]))).toBe("TWFu");
  });

  it("decodes known value", () => {
    expect(fromB64("TWFu")).toEqual(new Uint8Array([77, 97, 110]));
  });
});

describe("toUtf8 / fromUtf8", () => {
  it("round-trips ASCII", () => {
    expect(fromUtf8(toUtf8("hello"))).toBe("hello");
  });

  it("round-trips multi-byte characters", () => {
    const s = "pässwörd 密码 🔐";
    expect(fromUtf8(toUtf8(s))).toBe(s);
  });

  it("encodes ASCII one byte per char", () => {
    expect(toUtf8("abc")).toEqual(new Uint8Array([97, 98, 99]));
  });
});

describe("randomBytes", () => {
  it("returns requested length", () => {
    expect(randomBytes(16).length).toBe(16);
    expect(randomBytes(64).length).toBe(64);
  });

  it("returns different values on successive calls", () => {
    expect(randomBytes(32)).not.toEqual(randomBytes(32));
  });
});

describe("constantTimeEqual", () => {
  it("equal arrays → true", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    expect(constantTimeEqual(a, b)).toBe(true);
  });

  it("different content → false", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it("different length → false", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("single-bit difference → false", () => {
    const a = new Uint8Array(32);
    const b = new Uint8Array(32);
    b[31] = 1;
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it("empty arrays → true", () => {
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});

describe("wipe", () => {
  it("zeroes the array in place", () => {
    const bytes = new Uint8Array([1, 2, 3, 255]);
    wipe(bytes);
    expect(bytes).toEqual(new Uint8Array(4));
  });
});
