import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { useAuthStore } from "../stores/auth";
import { initApiClient } from "../lib/api/client";
import { deriveLoginKeys } from "../lib/crypto/key-hierarchy";
import { toB64 } from "../lib/crypto/utils";
import { getTotpSetupKey, enableTotp, disableTotp } from "../lib/api/account";
import styles from "./TotpSetup.module.css";

type Step = "auth" | "enroll" | "done";

export function TotpSetupPage() {
  const navigate = useNavigate();
  const { user, serverUrl } = useAuthStore();

  const [step, setStep] = useState<Step>("auth");
  const [masterPassword, setMasterPassword] = useState("");
  const [masterPasswordHash, setMasterPasswordHash] = useState("");
  const [totpKey, setTotpKey] = useState("");
  const [alreadyEnabled, setAlreadyEnabled] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Build otpauth URI and QR code whenever totpKey changes
  useEffect(() => {
    if (!totpKey || !user) return;
    const uri = `otpauth://totp/NadSafe:${encodeURIComponent(user.email)}?secret=${totpKey}&issuer=NadSafe`;
    QRCode.toDataURL(uri, { width: 220, margin: 2 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [totpKey, user]);

  async function handleAuth(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError("");
    setLoading(true);
    try {
      const client = initApiClient(serverUrl);
      const kdfParams = user.kdfType === "argon2id"
        ? { type: "argon2id" as const, mCost: user.kdfParams.mCost ?? 65536, tCost: user.kdfParams.tCost ?? 3, pCost: user.kdfParams.pCost ?? 4 }
        : { type: "pbkdf2" as const, iterations: user.kdfParams.iterations ?? 600000 };
      const { authHash } = await deriveLoginKeys(masterPassword, user.email, kdfParams);
      const hash = toB64(authHash);
      const setup = await getTotpSetupKey(client);
      setMasterPasswordHash(hash);
      setTotpKey(setup.key ?? "");
      setAlreadyEnabled(setup.enabled);
      setStep("enroll");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const client = initApiClient(serverUrl);
      await enableTotp(client, { masterPasswordHash, token: verifyCode, key: totpKey });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable 2FA");
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable() {
    if (!confirm("Disable two-factor authentication? Your account will be less secure.")) return;
    setError("");
    setLoading(true);
    try {
      const client = initApiClient(serverUrl);
      await disableTotp(client, { masterPasswordHash, type: 0 });
      setAlreadyEnabled(false);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable 2FA");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <button className={styles.back} onClick={() => navigate("/settings")}>← Settings</button>

        <h1 className={styles.title}>Two-Factor Authentication</h1>
        <p className={styles.subtitle}>
          Secure your account with an authenticator app (Google Authenticator, Authy, etc.)
        </p>

        {/* ── Step 1: re-authenticate ─────────────────────────────────────── */}
        {step === "auth" && (
          <form onSubmit={handleAuth} className={styles.form}>
            <p className={styles.hint}>
              Enter your master password to continue.
            </p>
            <div className={styles.field}>
              <label className={styles.label}>Master password</label>
              <input
                type="password"
                className={styles.input}
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                autoFocus
                required
                autoComplete="current-password"
              />
            </div>
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={styles.primaryBtn} disabled={loading}>
              {loading ? "Verifying…" : "Continue"}
            </button>
          </form>
        )}

        {/* ── Step 2: show QR + verify code ──────────────────────────────── */}
        {step === "enroll" && (
          <div className={styles.enrollSection}>
            {alreadyEnabled && (
              <div className={styles.enabledBanner}>
                ✅ Two-factor authentication is currently <strong>enabled</strong>.
              </div>
            )}

            <div className={styles.instructions}>
              <p><strong>1.</strong> Scan this QR code with your authenticator app:</p>
            </div>

            {qrDataUrl
              ? <img src={qrDataUrl} alt="TOTP QR code" className={styles.qr} />
              : <div className={styles.qrPlaceholder}>Generating QR…</div>
            }

            <details className={styles.manualEntry}>
              <summary>Can't scan? Enter manually</summary>
              <div className={styles.secretBox}>
                <code className={styles.secret}>{totpKey}</code>
                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={() => navigator.clipboard.writeText(totpKey).catch(() => null)}
                >
                  Copy
                </button>
              </div>
            </details>

            <form onSubmit={handleEnable} className={styles.form}>
              <p><strong>2.</strong> Enter the 6-digit code from your app to confirm:</p>
              <div className={styles.field}>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  className={`${styles.input} ${styles.codeInput}`}
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  autoComplete="one-time-code"
                  required
                />
              </div>

              {error && <p className={styles.error}>{error}</p>}

              <div className={styles.btnRow}>
                <button type="submit" className={styles.primaryBtn} disabled={loading || verifyCode.length < 6}>
                  {loading ? "Enabling…" : alreadyEnabled ? "Re-verify & save" : "Enable 2FA"}
                </button>
                {alreadyEnabled && (
                  <button type="button" className={styles.dangerBtn} onClick={handleDisable} disabled={loading}>
                    Disable 2FA
                  </button>
                )}
              </div>
            </form>
          </div>
        )}

        {/* ── Step 3: success ─────────────────────────────────────────────── */}
        {step === "done" && (
          <div className={styles.doneSection}>
            {alreadyEnabled === false
              ? <p className={styles.doneMsg}>✅ Two-factor authentication has been <strong>disabled</strong>.</p>
              : <p className={styles.doneMsg}>✅ Two-factor authentication is now <strong>active</strong>. You'll be asked for a code at each login.</p>
            }
            <button className={styles.primaryBtn} onClick={() => navigate("/settings")}>
              Back to Settings
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
