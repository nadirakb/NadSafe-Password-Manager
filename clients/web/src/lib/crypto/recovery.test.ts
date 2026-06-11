import { describe, it, expect } from "vitest";
import {
  generateRecoveryEntropy,
  entropyToPhrase,
  phraseToEntropy,
  wrapUserKeyWithRecovery,
  unwrapUserKeyWithRecovery,
} from "./recovery";
import { symKeyFromBytes } from "./types";

function userKey() {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) bytes[i] = (i * 7 + 3) & 0xff;
  return symKeyFromBytes(bytes);
}

describe("generateRecoveryEntropy", () => {
  it("returns 32 random bytes", () => {
    const e = generateRecoveryEntropy();
    expect(e.length).toBe(32);
    expect(generateRecoveryEntropy()).not.toEqual(e);
  });
});

describe("entropyToPhrase / phraseToEntropy", () => {
  it("formats 32 bytes as 8 space-separated groups of 8 hex chars", () => {
    const entropy = new Uint8Array(32);
    for (let i = 0; i < 32; i++) entropy[i] = i;
    const phrase = entropyToPhrase(entropy);
    const groups = phrase.split(" ");
    expect(groups.length).toBe(8);
    for (const g of groups) expect(g).toMatch(/^[0-9a-f]{8}$/);
    expect(groups[0]).toBe("00010203");
    expect(groups[7]).toBe("1c1d1e1f");
  });

  it("round-trips entropy", () => {
    const entropy = generateRecoveryEntropy();
    expect(phraseToEntropy(entropyToPhrase(entropy))).toEqual(entropy);
  });

  it("tolerates extra/missing whitespace in phrase", () => {
    const entropy = generateRecoveryEntropy();
    const phrase = entropyToPhrase(entropy);
    expect(phraseToEntropy(phrase.replace(/ /g, "   "))).toEqual(entropy);
    expect(phraseToEntropy(phrase.replace(/ /g, ""))).toEqual(entropy);
  });

  it("rejects wrong-length phrases", () => {
    expect(() => phraseToEntropy("a1b2c3d4")).toThrow(/Invalid recovery phrase length/);
    expect(() => phraseToEntropy("")).toThrow(/Invalid recovery phrase length/);
    const tooLong = "ab".repeat(33);
    expect(() => phraseToEntropy(tooLong)).toThrow(/Invalid recovery phrase length/);
  });
});

describe("wrapUserKeyWithRecovery / unwrapUserKeyWithRecovery", () => {
  it("recovers the user key from the phrase", async () => {
    const key = userKey();
    const entropy = generateRecoveryEntropy();
    const phrase = entropyToPhrase(entropy);

    const wrapped = await wrapUserKeyWithRecovery(key, entropy);
    expect(wrapped.startsWith("2.")).toBe(true);

    const recovered = await unwrapUserKeyWithRecovery(wrapped, phrase);
    expect(recovered.encKey).toEqual(key.encKey);
    expect(recovered.macKey).toEqual(key.macKey);
  });

  it("rejects recovery with the wrong phrase", async () => {
    const wrapped = await wrapUserKeyWithRecovery(userKey(), generateRecoveryEntropy());
    const wrongPhrase = entropyToPhrase(generateRecoveryEntropy());
    await expect(unwrapUserKeyWithRecovery(wrapped, wrongPhrase)).rejects.toThrow(
      /MAC verification failed/,
    );
  });

  it("different entropy produces different wrapped blobs for same key", async () => {
    const key = userKey();
    const a = await wrapUserKeyWithRecovery(key, generateRecoveryEntropy());
    const b = await wrapUserKeyWithRecovery(key, generateRecoveryEntropy());
    expect(a).not.toBe(b);
  });
});
