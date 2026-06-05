import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { setSessionUserKey, setSessionRsaKey } from "../stores/session";
import { initApiClient } from "../lib/api/client";
import { refreshToken, getOrCreateDeviceId } from "../lib/api/auth";
import { deriveLoginKeys, unwrapUserKey } from "../lib/crypto/key-hierarchy";
import { decryptRsaPrivateKey } from "../lib/crypto/rsa";
import { symKeyFromBytes } from "../lib/crypto/types";
import styles from "./Auth.module.css";

export function UnlockPage() {
  const navigate = useNavigate();
  const { user, serverUrl, refreshToken: storedRefreshToken, encryptedUserKey, encryptedPrivateKey, unlock, logout } = useAuthStore();

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError("");
    setLoading(true);
    try {
      const client = initApiClient(serverUrl);

      // Re-derive the stretched master key from the password
      // mCost stored in KiB (already converted from MB during login) — use directly
      const kdfParams = user.kdfType === "argon2id"
        ? { type: "argon2id" as const, mCost: user.kdfParams.mCost ?? 65536, tCost: user.kdfParams.tCost ?? 3, pCost: user.kdfParams.pCost ?? 4 }
        : { type: "pbkdf2" as const, iterations: user.kdfParams.iterations ?? 600000 };

      const { encKey, macKey } = await deriveLoginKeys(password, user.email, kdfParams);

      // Get a fresh access token via refresh token
      if (!storedRefreshToken) throw new Error("No refresh token — please sign in again");
      if (!encryptedUserKey) throw new Error("No vault key on file — please sign in again");

      const tokenRes = await refreshToken(client, storedRefreshToken, getOrCreateDeviceId());
      client.setToken(tokenRes.access_token);

      // Unwrap user key — MAC mismatch = wrong master password
      const userKey = await unwrapUserKey(encryptedUserKey, { encKey, macKey });
      setSessionUserKey(userKey);

      // Restore RSA private key for org operations
      if (encryptedPrivateKey && !encryptedPrivateKey.startsWith("2.placeholder")) {
        try {
          const sym = symKeyFromBytes(userKey.encKey);
          const rsaKey = await decryptRsaPrivateKey(encryptedPrivateKey, sym);
          setSessionRsaKey(rsaKey);
        } catch {
          // non-fatal
        }
      }

      unlock(tokenRes.access_token);
      navigate("/vault");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unlock failed";
      setError(msg.includes("MAC") ? "Incorrect master password" : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.logo}>🔒</span>
          <h1 className={styles.title}>Vault locked</h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
            Signed in as <strong>{user?.email}</strong>
          </p>
        </div>

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
        </form>

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
