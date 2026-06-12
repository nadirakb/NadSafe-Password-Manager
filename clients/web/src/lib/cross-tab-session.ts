/**
 * Cross-tab session sharing — keep all same-origin NadSafe tabs unlocked together.
 *
 * The decrypted user key lives only in per-tab JS memory (stores/session.ts), so
 * a newly opened tab/window starts with no key and would prompt for the PIN even
 * while another tab is unlocked. This lets a fresh tab borrow the live key from
 * an already-unlocked tab over a same-origin BroadcastChannel — the key never
 * touches disk, preserving the "key never at rest" property.
 *
 * Security: BroadcastChannel is same-origin only. Anyone able to post on it
 * already runs script in this origin and could read getSessionUserKey()
 * directly, so this adds no exposure beyond same-origin XSS (already game over).
 * Adoption is gated on the tab being authenticated — it restores an existing
 * session, it never creates one.
 */

import { useAuthStore } from "../stores/auth";
import {
  getSessionUserKey, setSessionUserKey,
  getSessionRsaKey, setSessionRsaKey,
} from "../stores/session";
import { initApiClient } from "./api/client";
import type { SymKey } from "./crypto/types";

const CHANNEL = "nadsafe-session";

interface SessionPayload {
  encKey: Uint8Array;
  macKey: Uint8Array;
  rsaKey: CryptoKey | null;
  accessToken: string;
  serverUrl: string;
}

type Msg =
  | { type: "REQUEST_KEY"; nonce: string }
  | { type: "KEY_RESPONSE"; nonce: string; payload: SessionPayload }
  | { type: "UNLOCKED" };

function channel(): BroadcastChannel | null {
  try { return new BroadcastChannel(CHANNEL); } catch { return null; }
}

/** Snapshot the live session for sharing, or null if this tab is locked. */
function currentPayload(): SessionPayload | null {
  const key = getSessionUserKey();
  const auth = useAuthStore.getState();
  if (!key || auth.isLocked || !auth.accessToken) return null;
  return {
    encKey: new Uint8Array(key.encKey),
    macKey: new Uint8Array(key.macKey),
    rsaKey: getSessionRsaKey(),
    accessToken: auth.accessToken,
    serverUrl: auth.serverUrl,
  };
}

/** Install the live key + token received from another tab. */
function adopt(p: SessionPayload): void {
  const userKey: SymKey = { encKey: new Uint8Array(p.encKey), macKey: new Uint8Array(p.macKey) };
  setSessionUserKey(userKey);
  if (p.rsaKey) setSessionRsaKey(p.rsaKey);
  initApiClient(p.serverUrl).setToken(p.accessToken);
  useAuthStore.getState().unlock(p.accessToken);
}

let responderStarted = false;

/**
 * Start answering key requests from other tabs (idempotent). Lives for the tab's
 * whole session; only ever responds while this tab itself is unlocked.
 */
export function startCrossTabResponder(): void {
  if (responderStarted) return;
  const ch = channel();
  if (!ch) return;
  responderStarted = true;
  ch.addEventListener("message", (e: MessageEvent<Msg>) => {
    if (e.data?.type !== "REQUEST_KEY") return;
    const payload = currentPayload();
    if (!payload) return; // locked — stay silent
    ch.postMessage({ type: "KEY_RESPONSE", nonce: e.data.nonce, payload } satisfies Msg);
  });
}

/**
 * Ask other tabs for the unlocked session. Resolves true if a tab answered and
 * this tab adopted the key, false after the timeout (no unlocked tab around).
 */
export function adoptSessionFromOtherTab(timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const ch = channel();
    if (!ch) { resolve(false); return; }
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let done = false;

    const finish = (adopted: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ch.removeEventListener("message", onMsg);
      ch.close();
      resolve(adopted);
    };
    const onMsg = (e: MessageEvent<Msg>) => {
      if (e.data?.type !== "KEY_RESPONSE" || e.data.nonce !== nonce) return;
      try { adopt(e.data.payload); finish(true); } catch { finish(false); }
    };
    const timer = setTimeout(() => finish(false), timeoutMs);

    ch.addEventListener("message", onMsg);
    ch.postMessage({ type: "REQUEST_KEY", nonce } satisfies Msg);
  });
}

/** Tell other tabs an unlock just happened so any sitting on /unlock can adopt. */
export function announceUnlock(): void {
  const ch = channel();
  if (!ch) return;
  ch.postMessage({ type: "UNLOCKED" } satisfies Msg);
  // Give the message a tick to flush before closing.
  setTimeout(() => ch.close(), 0);
}

/** Subscribe to unlock announcements from other tabs. Returns an unsubscribe fn. */
export function onUnlockAnnounced(cb: () => void): () => void {
  const ch = channel();
  if (!ch) return () => {};
  const h = (e: MessageEvent<Msg>) => { if (e.data?.type === "UNLOCKED") cb(); };
  ch.addEventListener("message", h);
  return () => { ch.removeEventListener("message", h); ch.close(); };
}
