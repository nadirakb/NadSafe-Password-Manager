import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { useRegister } from "../hooks/useAuth";
import { ShowRecoveryPhrase } from "../components/ShowRecoveryPhrase";
import { passwordStrength } from "../lib/password-strength";
import { NadSafeLogo } from "../components/NadSafeLogo";
import styles from "./Auth.module.css";

export function RegisterPage() {
  const { serverUrl } = useAuthStore();
  const { doRegister, loading, error, recoveryEntropy, dismissRecovery } = useRegister();

  const [server, setServer] = useState(serverUrl || window.location.origin);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState("");

  const strength = passwordStrength(password);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError("");
    if (password !== confirm) { setLocalError("Passwords do not match"); return; }
    if (strength.score < 2) { setLocalError("Master password too weak — at least 12 chars, mixed case and numbers"); return; }
    await doRegister(server, email, name, password);
  }

  const displayError = localError || error;

  return (
    <>
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.header}>
            <NadSafeLogo size={48} />
            <h1 className={styles.title}>Create your account</h1>
          </div>

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="server">Server URL</label>
              <input id="server" type="url" className={styles.input} value={server}
                onChange={(e) => setServer(e.target.value)} placeholder="https://vault.example.com" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="name">Full name</label>
              <input id="name" type="text" className={styles.input} value={name}
                onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" autoComplete="name" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="email">Email address</label>
              <input id="email" type="email" className={styles.input} value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="password">Master password</label>
              <input id="password" type="password" className={styles.input} value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="At least 12 characters"
                autoComplete="new-password" required />
              {password.length > 0 && (
                <>
                  <div className={styles.strengthBar}>
                    <div className={styles.strengthFill}
                      style={{ width: `${(strength.score / 5) * 100}%`, background: strength.color }} />
                  </div>
                  <span style={{ fontSize: "var(--font-size-xs)", color: strength.color }}>{strength.label}</span>
                </>
              )}
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="confirm">Confirm master password</label>
              <input id="confirm" type="password" className={styles.input} value={confirm}
                onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat your master password"
                autoComplete="new-password" required />
            </div>

            {displayError && <p className={styles.error}>{displayError}</p>}

            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className={styles.hint}>
            Your master password never leaves this device. Losing it and your recovery phrase means your vault is permanently unrecoverable.
          </p>

          <p className={styles.footer}>Already have an account? <Link to="/login">Sign in</Link></p>
        </div>
      </div>

      {recoveryEntropy && (
        <ShowRecoveryPhrase entropy={recoveryEntropy} onDismiss={dismissRecovery} />
      )}
    </>
  );
}
