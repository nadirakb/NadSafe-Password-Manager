import { describe, it, expect } from "vitest";
import { generatePassword, passwordEntropy, DEFAULT_PASSWORD_CONFIG, type PasswordConfig } from "./password-gen";

const AMBIGUOUS = ["I", "l", "1", "O", "0"];

function count(pw: string, re: RegExp): number {
  return (pw.match(re) ?? []).length;
}

describe("generatePassword", () => {
  it("respects requested length", () => {
    for (const length of [8, 12, 20, 64, 128]) {
      expect(generatePassword({ ...DEFAULT_PASSWORD_CONFIG, length }).length).toBe(length);
    }
  });

  it("default config produces a 20-char password", () => {
    expect(generatePassword().length).toBe(20);
  });

  it("satisfies per-class minimums (over many runs)", () => {
    const cfg: PasswordConfig = {
      ...DEFAULT_PASSWORD_CONFIG,
      length: 12,
      minUppercase: 2,
      minLowercase: 3,
      minNumbers: 2,
      minSpecial: 2,
    };
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword(cfg);
      expect(count(pw, /[A-Z]/g)).toBeGreaterThanOrEqual(2);
      expect(count(pw, /[a-z]/g)).toBeGreaterThanOrEqual(3);
      expect(count(pw, /[0-9]/g)).toBeGreaterThanOrEqual(2);
      expect(count(pw, /[^A-Za-z0-9]/g)).toBeGreaterThanOrEqual(2);
    }
  });

  it("only uses enabled character classes", () => {
    const cfg: PasswordConfig = {
      ...DEFAULT_PASSWORD_CONFIG,
      uppercase: false,
      symbols: false,
      length: 30,
    };
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword(cfg);
      expect(pw).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("digits-only config produces digits only", () => {
    const cfg: PasswordConfig = {
      ...DEFAULT_PASSWORD_CONFIG,
      uppercase: false,
      lowercase: false,
      symbols: false,
      length: 16,
    };
    expect(generatePassword(cfg)).toMatch(/^[0-9]{16}$/);
  });

  it("avoidAmbiguous excludes I, l, 1, O, 0", () => {
    const cfg: PasswordConfig = { ...DEFAULT_PASSWORD_CONFIG, avoidAmbiguous: true, length: 64 };
    for (let i = 0; i < 30; i++) {
      const pw = generatePassword(cfg);
      for (const ch of AMBIGUOUS) {
        expect(pw).not.toContain(ch);
      }
    }
  });

  it("throws when no character classes are enabled", () => {
    expect(() =>
      generatePassword({
        ...DEFAULT_PASSWORD_CONFIG,
        uppercase: false,
        lowercase: false,
        numbers: false,
        symbols: false,
      }),
    ).toThrow(/No character classes enabled/);
  });

  it("produces different passwords on successive calls", () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});

describe("passwordEntropy", () => {
  it("returns 0 for empty string", () => {
    expect(passwordEntropy("")).toBe(0);
  });

  it("lowercase-only: floor(len * log2(26))", () => {
    // 10 * log2(26) ≈ 47.0
    expect(passwordEntropy("abcdefghij")).toBe(47);
  });

  it("digits-only: floor(len * log2(10))", () => {
    // 6 * log2(10) ≈ 19.9
    expect(passwordEntropy("123456")).toBe(19);
  });

  it("all four classes: pool of 94", () => {
    // 8 * log2(94) ≈ 52.4
    expect(passwordEntropy("aA1!aA1!")).toBe(52);
  });

  it("more classes → more entropy at same length", () => {
    expect(passwordEntropy("aaaaaaaa")).toBeLessThan(passwordEntropy("aA1!aA1!"));
  });
});
