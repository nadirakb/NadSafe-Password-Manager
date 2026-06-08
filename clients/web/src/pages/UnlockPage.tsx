import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { setSessionUserKey, setSessionRsaKey } from "../stores/session";
import { initApiClient } from "../lib/api/client";
import { refreshToken, getOrCreateDeviceId } from "../lib/api/auth";
import { deriveLoginKeys, unwrapUserKey } from "../lib/crypto/key-hierarchy";
import { decryptRsaPrivateKey } from "../lib/crypto/rsa";
import { type SymKey } from "../lib/crypto/types";
import { isTauri } from "../lib/platform";
import { pinIsSet, getPinLength, unlockWithPin, type PinUnlockError } from "../lib/crypto/pin";
import { PinInput } from "../components/PinInput";
import { NadSafeLogo } from "../components/NadSafeLogo";
import styles from "./Auth.module.css";

export function UnlockPage() {
  const navigate = useNavigate();
  const { user, serverUrl, refreshToken: storedRefreshToken, encryptedUserKey, encryptedPrivateKey, unlock, logout } = useAuthStore();

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // PIN unlock is only offered on the desktop app and once a PIN is set.
  const pinAvailable = isTauri() && pinIsSet();
  const [usePin, setUsePin] = useState(pinAvailable);
  const [pin, setPin] = useState("");
  const pinLength = getPinLength() ?? 4;

  /** Refresh the access token, install the session keys, and enter the vault. */
  async function completeUnlock(userKey: SymKey) {
    const client = initApiClient(serverUrl);
    if (!storedRefreshToken) throw new Error("No refresh token — please sign in again");

    const tokenRes = await refreshToken(client, storedRefreshToken, getOrCreateDeviceId());
    client.setToken(tokenRes.access_token);

    setSessionUserKey(userKey);

    // Restore RSA private key for org operations.
    // EncString must contain "|" — rejects null, empty, and legacy placeholder values.
    if (encryptedPrivateKey && encryptedPrivateKey.includes("|")) {
      try {
        const rsaKey = await decryptRsaPrivateKey(encryptedPrivateKey, userKey);
        setSessionRsaKey(rsaKey);
      } catch {
        // non-fatal
      }
    }

    unlock(tokenRes.access_token);
    navigate("/vault");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError("");
    setLoading(true);
    try {
      // Re-derive the stretched master key from the password.
      // mCost stored in KiB (already converted from MB during login) — use directly.
      const kdfParams = user.kdfType === "argon2id"
        ? { type: "argon2id" as const, mCost: user.kdfParams.mCost ?? 65536, tCost: user.kdfParams.tCost ?? 3, pCost: user.kdfParams.pCost ?? 4 }
        : { type: "pbkdf2" as const, iterations: user.kdfParams.iterations ?? 600000 };

      const { encKey, macKey } = await deriveLoginKeys(password, user.email, kdfParams);
      if (!encryptedUserKey) throw new Error("No vault key on file — please sign in again");

      // Unwrap user key — MAC mismatch = wrong master password.
      const userKey = await unwrapUserKey(encryptedUserKey, { encKey, macKey });
      await completeUnlock(userKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unlock failed";
      setError(msg.includes("MAC") ? "Incorrect master password" : msg);
    } finally {
      setLoading(false);
    }
  }

  async function handlePinUnlock(value: string) {
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const userKey = await unlockWithPin(value);
      await completeUnlock(userKey);
    } catch (err) {
      setPin("");
      const e = err as PinUnlockError;
      if (e.wiped) setUsePin(false); // PIN cleared after too many tries — fall back to password
      setError(e.message || "Wrong PIN");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <NadSafeLogo size={48} />
          <h1 className={styles.title}>Vault locked</h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
            Signed in as <strong>{user?.email}</strong>
          </p>
        </div>

        {usePin ? (
          <div className={styles.form}>
            <label className={styles.label} style={{ textAlign: "center" }}>Enter your PIN</label>
            <PinInput
              length={pinLength}
              value={pin}
              onChange={setPin}
              onComplete={handlePinUnlock}
              autoFocus
              disabled={loading}
            />
            {error && <p className={styles.error}>{error}</p>}
            <button
              type="button"
              className={styles.submitBtn}
              disabled={loading || pin.length < pinLength}
              onClick={() => handlePinUnlock(pin)}
            >
              {loading ? "Unlocking…" : "Unlock"}
            </button>
            <button
              type="button"
              style={linkBtn}
              onClick={() => { setUsePin(false); setError(""); }}
            >
              Use master password instead
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form}>
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
                autoFocus
                required
              />
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? "Unlocking…" : "Unlock"}
            </button>

            {pinAvailable && (
              <button
                type="button"
                style={linkBtn}
                onClick={() => { setUsePin(true); setError(""); }}
              >
                Use PIN instead
              </button>
            )}
          </form>
        )}

        <p className={styles.footer}>
          <button
            style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)", background: "none", border: "none", cursor: "pointer" }}
            onClick={logout}
          >
            Sign out instead
          </button>
        </p>
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-sm)",
  background: "none",
  border: "none",
  cursor: "pointer",
  marginTop: 4,
};
