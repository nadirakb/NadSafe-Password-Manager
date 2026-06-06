/**
 * Client-side login rate-limiting.
 *
 * Backs off exponentially after repeated failures to prevent:
 *   - Argon2id being hammered client-side
 *   - Trivial online brute-force via rapid page-reload
 *
 * State persists in localStorage keyed by `ns_rl:${serverUrl}|${email}`.
 */

export interface RLState {
  fails: number;
  /** Unix epoch ms when lockout expires; 0 = not locked. */
  lockedUntil: number;
}

export function rlKey(serverUrl: string, email: string): string {
  return `ns_rl:${serverUrl.replace(/\/$/, "")}|${email}`;
}

export function getRLState(serverUrl: string, email: string): RLState {
  try {
    const raw = localStorage.getItem(rlKey(serverUrl, email));
    if (raw) return JSON.parse(raw) as RLState;
  } catch { /* ignore */ }
  return { fails: 0, lockedUntil: 0 };
}

export function setRLState(serverUrl: string, email: string, s: RLState): void {
  try { localStorage.setItem(rlKey(serverUrl, email), JSON.stringify(s)); } catch { /* ignore */ }
}

export function clearRLState(serverUrl: string, email: string): void {
  try { localStorage.removeItem(rlKey(serverUrl, email)); } catch { /* ignore */ }
}

/**
 * Backoff seconds after N total failures.
 * First 3 failures: no delay. Then: 30 → 60 → 120 → 300 → 600 s.
 */
export function backoffSeconds(fails: number): number {
  if (fails < 3) return 0;
  return [30, 60, 120, 300, 600][Math.min(fails - 3, 4)];
}
