import { describe, it, expect, beforeEach } from "vitest";
import { setSessionUserKey, getSessionUserKey, clearSessionKey } from "./session";
import { symKeyFromBytes } from "../lib/crypto/types";

beforeEach(() => {
  clearSessionKey();
});

describe("session key store", () => {
  it("starts empty", () => {
    expect(getSessionUserKey()).toBeNull();
  });

  it("stores and returns the user key", () => {
    const key = symKeyFromBytes(new Uint8Array(64).fill(7));
    setSessionUserKey(key);
    expect(getSessionUserKey()).toBe(key);
  });

  it("clearSessionKey zeroes the key material before dropping it", () => {
    const key = symKeyFromBytes(new Uint8Array(64).fill(7));
    setSessionUserKey(key);
    clearSessionKey();
    expect(getSessionUserKey()).toBeNull();
    // The original buffers must be wiped, not just dereferenced
    expect(key.encKey).toEqual(new Uint8Array(32));
    expect(key.macKey).toEqual(new Uint8Array(32));
  });
});
