import { describe, it, expect } from "vitest";
import { generateTotp, totpSecondsRemaining } from "./totp";

/**
 * RFC 6238 Appendix B test vectors (SHA-1).
 * The RFC secret is ASCII "12345678901234567890", which is
 * "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" in base32. The RFC lists 8-digit codes;
 * our implementation emits 6 digits, which are the last 6 of the RFC values.
 */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("generateTotp (RFC 6238 vectors)", () => {
  it.each([
    [59, "287082"], // RFC: 94287082
    [1111111109, "081804"], // RFC: 07081804
    [1111111111, "050471"], // RFC: 14050471
    [1234567890, "005924"], // RFC: 89005924
    [2000000000, "279037"], // RFC: 69279037
    [20000000000, "353130"], // RFC: 65353130
  ])("t=%d → %s", async (timestamp, expected) => {
    expect(await generateTotp(RFC_SECRET, timestamp)).toBe(expected);
  });

  it("always returns 6 digits with leading zeros preserved", async () => {
    const code = await generateTotp(RFC_SECRET, 1234567890);
    expect(code).toMatch(/^\d{6}$/);
    expect(code).toBe("005924"); // leading zero must not be stripped
  });

  it("same 30s window produces the same code", async () => {
    expect(await generateTotp(RFC_SECRET, 60)).toBe(await generateTotp(RFC_SECRET, 89));
  });

  it("adjacent windows produce different codes", async () => {
    expect(await generateTotp(RFC_SECRET, 59)).not.toBe(await generateTotp(RFC_SECRET, 60));
  });
});

describe("base32 secret handling", () => {
  it("accepts lowercase secrets", async () => {
    expect(await generateTotp(RFC_SECRET.toLowerCase(), 59)).toBe("287082");
  });

  it("accepts secrets with spaces (as copied from authenticator setup pages)", async () => {
    const spaced = (RFC_SECRET.match(/.{1,4}/g) ?? []).join(" ");
    expect(await generateTotp(spaced, 59)).toBe("287082");
  });

  it("accepts trailing padding '='", async () => {
    expect(await generateTotp(`${RFC_SECRET}====`, 59)).toBe("287082");
  });

  it("rejects invalid base32 characters", async () => {
    await expect(generateTotp("INVALID1SECRET!", 59)).rejects.toThrow(/Invalid base32 character/);
  });
});

describe("totpSecondsRemaining", () => {
  it("returns 30 at the start of a window", () => {
    expect(totpSecondsRemaining(0)).toBe(30);
    expect(totpSecondsRemaining(60)).toBe(30);
  });

  it("returns 1 at the end of a window", () => {
    expect(totpSecondsRemaining(29)).toBe(1);
    expect(totpSecondsRemaining(59)).toBe(1);
  });

  it("counts down across the window", () => {
    expect(totpSecondsRemaining(45)).toBe(15);
  });
});
