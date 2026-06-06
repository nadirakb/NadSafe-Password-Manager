/**
 * Subsequence fuzzy-match with tiered scoring.
 *
 * Tiers (higher = better match):
 *   1000+ : exact substring (penalised by position)
 *   500   : word-start prefix match
 *   1-N   : subsequence (each char of query appears in order in text)
 *   0     : no query (everything matches)
 */
export function fuzzyMatch(text: string, query: string): { match: boolean; score: number } {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return { match: true, score: 0 };

  // Tier 1: exact substring — score penalised by how late it appears
  const exactIdx = t.indexOf(q);
  if (exactIdx !== -1) return { match: true, score: 1000 - exactIdx };

  // Tier 2: subsequence — each char of query must appear in order in text
  let ti = 0, qi = 0, score = 0;
  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) { score++; qi++; }
    ti++;
  }
  return { match: qi === q.length, score };
}
