import { describe, it, expect } from "vitest";
import { passwordStrength } from "./password-strength";

describe("passwordStrength", () => {
  it("empty → score 0, label Too short", () => {
    const r = passwordStrength("");
    expect(r.score).toBe(0);
    expect(r.label).toBe("Too short");
  });

  it("short lowercase only → score 0", () => {
    expect(passwordStrength("abc").score).toBe(0);
  });

  it("12-char lowercase → score 1 (length ≥ 12 satisfied)", () => {
    const r = passwordStrength("abcdefghijkl");
    expect(r.score).toBeGreaterThanOrEqual(1);
  });

  it("adds score for uppercase", () => {
    const withUpper = passwordStrength("Abcdefghijkl");
    const withoutUpper = passwordStrength("abcdefghijkl");
    expect(withUpper.score).toBeGreaterThan(withoutUpper.score);
  });

  it("adds score for digit", () => {
    const with_ = passwordStrength("abcdefghijkl1");
    const without_ = passwordStrength("abcdefghijkl");
    expect(with_.score).toBeGreaterThan(without_.score);
  });

  it("adds score for special char", () => {
    const with_ = passwordStrength("abcdefghijkl!");
    const without_ = passwordStrength("abcdefghijkl");
    expect(with_.score).toBeGreaterThan(without_.score);
  });

  it("20+ chars gives extra length bonus", () => {
    const long = passwordStrength("abcdefghijklmnopqrst");
    const short = passwordStrength("abcdefghijkl");
    expect(long.score).toBeGreaterThan(short.score);
  });

  it("strong password → score 4, label Strong", () => {
    // length<20, has upper, digit, special → 1+1+1+1 = 4
    const r = passwordStrength("Tr0ub4dor&3XyZ!20");
    expect(r.score).toBe(4);
    expect(r.label).toBe("Strong");
  });

  it("very strong (20+ all classes) → score 5, label Very strong", () => {
    const r = passwordStrength("Tr0ub4dor&3XyZ!2025ab");
    expect(r.score).toBe(5);
    expect(r.label).toBe("Very strong");
  });

  it("color changes with score", () => {
    const weak = passwordStrength("abc");
    const strong = passwordStrength("Tr0ub4dor&3XyZ!2025");
    expect(weak.color).not.toBe(strong.color);
  });
});
