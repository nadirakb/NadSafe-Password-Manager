import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import styles from "./Auth.module.css";

export function LoginPage() {
  const navigate = useNavigate();
  const { serverUrl, setServerUrl, login } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState(serverUrl || "https://");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      setServerUrl(server);

      // TODO: call API — preauth to get KDF params, then derive key and authenticate
      // For now, mock a successful login for UI development
      await new Promise((r) => setTimeout(r, 800));
      login(
        {
          id: "mock-id",
          email,
          name: email.split("@")[0],
          kdfType: "argon2id",
          kdfParams: { mCost: 65536, tCost: 3, pCost: 4 },
        },
        "mock-access-token",
        "mock-refresh-token",
      );
      navigate("/vault");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.logo}>NS</span>
          <h1 className={styles.title}>Sign in to NadSafe</h1>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="server">
              Server URL
            </label>
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
            <label className={styles.label} htmlFor="email">
              Email address
            </label>
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
            <label className={styles.label} htmlFor="password">
              Master password
            </label>
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

          {error && <p className={styles.error}>{error}</p>}

          <button
            type="submit"
            className={styles.submitBtn}
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className={styles.footer}>
          No account?{" "}
          <Link to="/register">Create one</Link>
        </p>
      </div>
    </div>
  );
}
