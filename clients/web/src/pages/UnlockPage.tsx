import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import styles from "./Auth.module.css";

export function UnlockPage() {
  const navigate = useNavigate();
  const { user, unlock, logout } = useAuthStore();

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // TODO: re-derive master key locally, re-decrypt vault key, verify against stored hash
      await new Promise((r) => setTimeout(r, 400));
      unlock("new-access-token");
      navigate("/vault");
    } catch {
      setError("Incorrect master password");
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
