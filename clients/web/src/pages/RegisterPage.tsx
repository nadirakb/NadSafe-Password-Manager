import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import styles from "./Auth.module.css";

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 20) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const labels = ["Too short", "Weak", "Fair", "Good", "Strong", "Very strong"];
  const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#16a34a", "#15803d"];
  return { score, label: labels[score] ?? "Strong", color: colors[score] ?? "#15803d" };
}

export function RegisterPage() {
  const navigate = useNavigate();
  const { serverUrl, setServerUrl, login } = useAuthStore();

  const [server, setServer] = useState(serverUrl || "https://");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const strength = passwordStrength(password);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (strength.score < 2) {
      setError("Master password is too weak — use at least 12 characters with mixed case and numbers");
      return;
    }

    setLoading(true);
    try {
      setServerUrl(server);
      // TODO: call API — derive KDF key, generate user key pair, register
      await new Promise((r) => setTimeout(r, 1000));
      login(
        {
          id: "new-mock-id",
          email,
          name,
          kdfType: "argon2id",
          kdfParams: { mCost: 65536, tCost: 3, pCost: 4 },
        },
        "mock-access-token",
        "mock-refresh-token",
      );
      navigate("/vault");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.logo}>NS</span>
          <h1 className={styles.title}>Create your account</h1>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
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
            <label className={styles.label} htmlFor="name">Full name</label>
            <input
              id="name"
              type="text"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Smith"
              autoComplete="name"
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
              placeholder="At least 12 characters"
              autoComplete="new-password"
              required
            />
            {password.length > 0 && (
              <>
                <div className={styles.strengthBar}>
                  <div
                    className={styles.strengthFill}
                    style={{
                      width: `${(strength.score / 5) * 100}%`,
                      background: strength.color,
                    }}
                  />
                </div>
                <span style={{ fontSize: "var(--font-size-xs)", color: strength.color }}>
                  {strength.label}
                </span>
              </>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="confirm">Confirm master password</label>
            <input
              id="confirm"
              type="password"
              className={styles.input}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your master password"
              autoComplete="new-password"
              required
            />
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className={styles.hint}>
          Your master password is never sent to the server. If you lose it and your recovery phrase, your vault cannot be recovered.
        </p>

        <p className={styles.footer}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
