import { describe, it, expect, beforeEach } from "vitest";
import { setPin, unlockWithPin, pinIsSet, getPinLength, removePin, type PinUnlockError } from "./pin";
import { symKeyFromBytes, symKeyToBytes } from "./types";

function userKey() {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) bytes[i] = (i * 5 + 9) & 0xff;
  return symKeyFromBytes(bytes);
}

beforeEach(() => {
  localStorage.clear();
});

describe("setPin", () => {
  it("rejects non-4/6-digit PINs", async () => {
    const key = userKey();
    for (const bad of ["123", "12345", "1234567", "abcd", "12a4", "", "12 34"]) {
      await expect(setPin(bad, key)).rejects.toThrow(/4 or 6 digits/);
    }
  });

  it("accepts 4-digit and 6-digit PINs", async () => {
    await setPin("1234", userKey());
    expect(pinIsSet()).toBe(true);
    await setPin("123456", userKey());
    expect(getPinLength()).toBe(6);
  });

  it("resets a stale attempt counter", async () => {
    localStorage.setItem("nadsafe_pin_attempts", "4");
    await setPin("1234", userKey());
    expect(localStorage.getItem("nadsafe_pin_attempts")).toBeNull();
  });

  it("does not store the user key in plaintext", async () => {
    const key = userKey();
    await setPin("1234", key);
    const blob = localStorage.getItem("nadsafe_pin") ?? "{}";
    const wrapped = new Uint8Array((JSON.parse(blob) as { wrapped: number[] }).wrapped);
    const raw = symKeyToBytes(key);
    // Wrapped blob must not contain the raw key bytes
    expect(wrapped.length).toBeGreaterThan(raw.length); // GCM tag adds bytes
    expect(Array.from(wrapped).join(",")).not.toContain(Array.from(raw.slice(0, 16)).join(","));
  });
});

describe("pinIsSet / getPinLength / removePin", () => {
  it("pinIsSet false when nothing stored", () => {
    expect(pinIsSet()).toBe(false);
    expect(getPinLength()).toBeNull();
  });

  it("getPinLength reflects stored PIN length", async () => {
    await setPin("1234", userKey());
    expect(getPinLength()).toBe(4);
  });

  it("getPinLength returns null for corrupt blob", () => {
    localStorage.setItem("nadsafe_pin", "not-json{{{");
    expect(getPinLength()).toBeNull();
  });

  it("removePin clears blob and attempt counter", async () => {
    await setPin("1234", userKey());
    localStorage.setItem("nadsafe_pin_attempts", "2");
    removePin();
    expect(pinIsSet()).toBe(false);
    expect(localStorage.getItem("nadsafe_pin_attempts")).toBeNull();
  });
});

describe("unlockWithPin", () => {
  it("throws when no PIN is set", async () => {
    await expect(unlockWithPin("1234")).rejects.toThrow(/No PIN set/);
  });

  it("unlocks with the correct PIN and returns the original key", async () => {
    const key = userKey();
    await setPin("1234", key);
    const unlocked = await unlockWithPin("1234");
    expect(unlocked.encKey).toEqual(key.encKey);
    expect(unlocked.macKey).toEqual(key.macKey);
  });

  it("clears the attempt counter on success", async () => {
    await setPin("1234", userKey());
    await unlockWithPin("9999").catch(() => null);
    expect(localStorage.getItem("nadsafe_pin_attempts")).toBe("1");
    await unlockWithPin("1234");
    expect(localStorage.getItem("nadsafe_pin_attempts")).toBeNull();
  });

  it("counts down attempts on wrong PIN", async () => {
    await setPin("1234", userKey());
    const err = await unlockWithPin("0000").catch((e: PinUnlockError) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as PinUnlockError).attemptsLeft).toBe(4);
    expect((err as PinUnlockError).message).toMatch(/4 attempts left/);
  });

  it("wipes the PIN blob after 5 wrong attempts", async () => {
    await setPin("1234", userKey());
    let lastErr: PinUnlockError | null = null;
    for (let i = 0; i < 5; i++) {
      lastErr = (await unlockWithPin("0000").then(
        () => null,
        (e: PinUnlockError) => e,
      )) as PinUnlockError;
    }
    expect(lastErr?.wiped).toBe(true);
    expect(lastErr?.message).toMatch(/Too many attempts/);
    expect(pinIsSet()).toBe(false);
    // After wipe, even the correct PIN cannot unlock
    await expect(unlockWithPin("1234")).rejects.toThrow(/No PIN set/);
  });

  it("correct PIN still works after some failed attempts (below limit)", async () => {
    const key = userKey();
    await setPin("123456", key);
    await unlockWithPin("000000").catch(() => null);
    await unlockWithPin("111111").catch(() => null);
    const unlocked = await unlockWithPin("123456");
    expect(unlocked.encKey).toEqual(key.encKey);
  });
});
