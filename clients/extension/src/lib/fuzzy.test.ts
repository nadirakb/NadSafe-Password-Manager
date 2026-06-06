import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("empty query matches everything with score 0", () => {
    expect(fuzzyMatch("GitHub", "")).toEqual({ match: true, score: 0 });
    expect(fuzzyMatch("", "")).toEqual({ match: true, score: 0 });
  });

  it("exact substring at position 0 → score 1000", () => {
    expect(fuzzyMatch("github", "git")).toEqual({ match: true, score: 1000 });
  });

  it("exact substring at position N → score 1000 - N", () => {
    // "hub" starts at index 3 in "github"
    expect(fuzzyMatch("github", "hub")).toEqual({ match: true, score: 997 });
  });

  it("earlier exact match scores higher than later", () => {
    const early = fuzzyMatch("github", "git");
    const late  = fuzzyMatch("xxxgit", "git");
    expect(early.score).toBeGreaterThan(late.score);
  });

  it("subsequence (not substring) → match with low score", () => {
    // "ghb" chars appear in order in "github" but not as substring
    const r = fuzzyMatch("github", "ghb");
    expect(r.match).toBe(true);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(1000);
  });

  it("subsequence score = number of matched chars", () => {
    // "ghu": g→match, h→match, u→match; score=3
    expect(fuzzyMatch("github", "ghu").score).toBe(3);
  });

  it("no match when subsequence fails", () => {
    expect(fuzzyMatch("github", "xyz").match).toBe(false);
    expect(fuzzyMatch("github", "xyz").score).toBe(0);
  });

  it("case-insensitive matching", () => {
    expect(fuzzyMatch("GitHub", "GIT").match).toBe(true);
    expect(fuzzyMatch("GITHUB", "git").match).toBe(true);
  });

  it("exact match outscores subsequence", () => {
    const exact  = fuzzyMatch("git", "git");
    const subseq = fuzzyMatch("gxixxt", "git");
    expect(exact.score).toBeGreaterThan(subseq.score);
  });

  it("empty text with non-empty query → no match", () => {
    const r = fuzzyMatch("", "a");
    expect(r.match).toBe(false);
    expect(r.score).toBe(0);
  });

  it("full string is matched with score 1000 for single-char queries", () => {
    expect(fuzzyMatch("a", "a")).toEqual({ match: true, score: 1000 });
  });

  it("query longer than text → no match", () => {
    expect(fuzzyMatch("hi", "hello").match).toBe(false);
  });
});
