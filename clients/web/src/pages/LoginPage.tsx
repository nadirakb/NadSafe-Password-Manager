import { useState, useEffect, useRef, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { useLogin } from "../hooks/useAuth";
import { getRLState, setRLState, clearRLState, backoffSeconds } from "../lib/rateLimit";
import styles from "./Auth.module.css";

export function LoginPage() {
  const { serverUrl } = useAuthStore();
  const { doLogin, loading, error, needsTwoFactor } = useLogin();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState(serverUrl || window.location.origin);
  const [totpToken, setTotpToken] = useState("");
  // lockedUntil: epoch ms when lockout expires; 0 = not locked.
  const [lockedUntil, setLockedUntil] = useState<number>(0);
  const [secsLeft, setSecsLeft] = useState<number>(0);
  const prevErrorRef = useRef<string | null>(null);

  // Re-sync lockedUntil from localStorage when email changes (restores countdown after page refresh)
  useEffect(() => {
    if (!email) return;
    const rl = getRLState(server, email);
    if (rl.lockedUntil > Date.now()) setLockedUntil(rl.lockedUntil);
  }, [email, server]);

  // Countdown timer — runs only when locked; updates secsLeft each second
  useEffect(() => {
    if (lockedUntil === 0) { setSecsLeft(0); return; }
    function tick() {
      const remaining = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setSecsLeft(remaining);
      if (remaining > 0) timerId = window.setTimeout(tick, 1000);
    }
    let timerId = window.setTimeout(tick, 0);
    return () => clearTimeout(timerId);
  }, [lockedUntil]);

  // On error from useLogin: record failure in localStorage, update lockedUntil state
  useEffect(() => {
    if (!error || error === prevErrorRef.current) return;
    prevErrorRef.current = error;
    if (error.includes("Two-factor")) return; // mid-flow, not a failure
    const rl = getRLState(server, email);
    const newFails = rl.fails + 1;
    const delay = backoffSeconds(newFails);
    const until = delay > 0 ? Date.now() + delay * 1000 : 0;
    setRLState(server, email, { fails: newFails, lockedUntil: until });
    setLockedUntil(until);
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (secsLeft > 0) return;
    prevErrorRef.current = null;
    await doLogin(server, email, password, needsTwoFactor ? totpToken : undefined);
    if (!error) { clearRLState(server, email); setLockedUntil(0); }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.logo}>NS</span>
          <h1 className={styles.title}>Sign in to NadSafe</h1>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {!needsTwoFactor && (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="server">Server URL</label>
                <input
                  id="server"
                  type="url"
                  className={styles.input}
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="https://vault.example.com"
                  required
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  className={styles.input}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="password">Master password</label>
                <input
                  id="password"
                  type="password"
                  className={styles.input}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your master password"
                  autoComplete="current-password"
                  required
                />
              </div>
            </>
          )}

          {needsTwoFactor && (
            <div className={styles.field}>
              <div className={styles.twoFactorBanner}>
                🔐 Two-factor authentication required
              </div>
              <label className={styles.label} htmlFor="totp">
                Authentication code (6 digits)
              </label>
              <input
                id="totp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                className={styles.input}
                value={totpToken}
                onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                autoComplete="one-time-code"
                autoFocus
                required
              />
              <p className={styles.twoFactorHint}>
                Enter the code from your authenticator app or security key.
              </p>
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}

          {secsLeft > 0 && (
            <p className={styles.error}>
              Too many failed attempts. Try again in {secsLeft}s.
            </p>
          )}

          <button type="submit" className={styles.submitBtn} disabled={loading || secsLeft > 0}>
            {loading
              ? needsTwoFactor ? "Verifying…" : "Signing in…"
              : secsLeft > 0 ? `Locked (${secsLeft}s)`
              : needsTwoFactor ? "Verify code" : "Sign in"}
          </button>
        </form>

        <p className={styles.footer}>
          No account? <Link to="/register">Create one</Link>
          {" · "}
          <Link to="/recover">Forgot password?</Link>
        </p>
      </div>
    </div>
  );
}
