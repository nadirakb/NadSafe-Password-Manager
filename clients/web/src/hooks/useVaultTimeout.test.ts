import { describe, it, expect } from "vitest";
import { getVaultTimeoutMinutes, setVaultTimeoutMinutes } from "./useVaultTimeout";

describe("getVaultTimeoutMinutes", () => {
  it("returns 15 when nothing stored (default)", () => {
    expect(getVaultTimeoutMinutes()).toBe(15);
  });

  it("returns stored value", () => {
    setVaultTimeoutMinutes(60);
    expect(getVaultTimeoutMinutes()).toBe(60);
  });

  it("returns 0 for 'never' setting", () => {
    setVaultTimeoutMinutes(0);
    expect(getVaultTimeoutMinutes()).toBe(0);
  });

  it("returns default for corrupt storage", () => {
    localStorage.setItem("nadsafe_vault_timeout_minutes", "not-a-number");
    expect(getVaultTimeoutMinutes()).toBe(15);
  });

  it("returns default for negative (setVaultTimeoutMinutes clamps to 0)", () => {
    setVaultTimeoutMinutes(-5);
    expect(getVaultTimeoutMinutes()).toBe(0);
  });
});

describe("setVaultTimeoutMinutes", () => {
  it("persists to localStorage", () => {
    setVaultTimeoutMinutes(30);
    expect(localStorage.getItem("nadsafe_vault_timeout_minutes")).toBe("30");
  });

  it("clamps negative to 0", () => {
    setVaultTimeoutMinutes(-1);
    expect(getVaultTimeoutMinutes()).toBe(0);
  });

  it("round-trips several values", () => {
    for (const v of [1, 5, 15, 30, 60, 240]) {
      setVaultTimeoutMinutes(v);
      expect(getVaultTimeoutMinutes()).toBe(v);
    }
  });
});
