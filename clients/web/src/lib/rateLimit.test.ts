import { describe, it, expect } from "vitest";
import { rlKey, getRLState, setRLState, clearRLState, backoffSeconds } from "./rateLimit";

const SERVER = "https://vault.example.com";
const EMAIL = "user@example.com";

describe("rlKey", () => {
  it("normalizes trailing slash", () => {
    expect(rlKey("https://vault.example.com/", EMAIL)).toBe(rlKey(SERVER, EMAIL));
  });

  it("includes server and email", () => {
    const key = rlKey(SERVER, EMAIL);
    expect(key).toContain("vault.example.com");
    expect(key).toContain(EMAIL);
  });

  it("different emails → different keys", () => {
    expect(rlKey(SERVER, "a@a.com")).not.toBe(rlKey(SERVER, "b@b.com"));
  });
});

describe("getRLState", () => {
  it("returns zero state when no entry", () => {
    expect(getRLState(SERVER, EMAIL)).toEqual({ fails: 0, lockedUntil: 0 });
  });

  it("returns stored state", () => {
    setRLState(SERVER, EMAIL, { fails: 3, lockedUntil: 9999999 });
    expect(getRLState(SERVER, EMAIL)).toEqual({ fails: 3, lockedUntil: 9999999 });
  });

  it("handles corrupt localStorage gracefully", () => {
    localStorage.setItem(rlKey(SERVER, EMAIL), "not-json{{{");
    expect(getRLState(SERVER, EMAIL)).toEqual({ fails: 0, lockedUntil: 0 });
  });
});

describe("setRLState / clearRLState", () => {
  it("round-trips state", () => {
    const state = { fails: 5, lockedUntil: Date.now() + 60_000 };
    setRLState(SERVER, EMAIL, state);
    expect(getRLState(SERVER, EMAIL)).toEqual(state);
  });

  it("clearRLState removes entry", () => {
    setRLState(SERVER, EMAIL, { fails: 2, lockedUntil: 0 });
    clearRLState(SERVER, EMAIL);
    expect(getRLState(SERVER, EMAIL)).toEqual({ fails: 0, lockedUntil: 0 });
  });
});

describe("backoffSeconds", () => {
  it("no delay for first 3 failures", () => {
    expect(backoffSeconds(0)).toBe(0);
    expect(backoffSeconds(1)).toBe(0);
    expect(backoffSeconds(2)).toBe(0);
  });

  it("30s after 3rd failure", () => {
    expect(backoffSeconds(3)).toBe(30);
  });

  it("60s after 4th failure", () => {
    expect(backoffSeconds(4)).toBe(60);
  });

  it("caps at 600s", () => {
    expect(backoffSeconds(7)).toBe(600);
    expect(backoffSeconds(100)).toBe(600);
  });

  it("progression: 30→60→120→300→600", () => {
    expect([3, 4, 5, 6, 7].map(backoffSeconds)).toEqual([30, 60, 120, 300, 600]);
  });
});
