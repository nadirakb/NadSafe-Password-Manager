import { useState, useEffect, type FormEvent } from "react";
import { useAuthStore } from "../stores/auth";
import { getApiClient } from "../lib/api/client";
import { changePassword, getTotpSetupKey, enableTotp, disableTotp } from "../lib/api/account";
import { useVaultStore } from "../stores/vault";
import { getSessionUserKey } from "../stores/session";
import { deriveLoginKeys, wrapUserKey } from "../lib/crypto/key-hierarchy";
import { toB64 } from "../lib/crypto/utils";
import { buildExportJson, buildExportCsv, downloadJson, downloadCsv } from "../lib/export";
import { checkExtensionInstalled, pushItemsToExtension } from "../lib/extension-bridge";
import { TotpDisplay } from "../components/TotpDisplay";
import styles from "./Settings.module.css";

// ─── Change Master Password ───────────────────────────────────────────────────

function ChangeMasterPassword() {
  const { user, encryptedUserKey } = useAuthStore();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPw !== confirmPw) { setError("New passwords do not match"); return; }
    if (newPw.length < 12) { setError("New password must be at least 12 characters"); return; }
    if (!user?.email || !encryptedUserKey) { setError("Account data missing — re-login required"); return; }
    const userKey = getSessionUserKey();
    if (!userKey) { setError("Vault is locked — unlock first"); return; }

    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const kdfType = user.kdfType;
      const kdfParams = kdfType === "argon2id"
        ? { type: "argon2id" as const, mCost: user.kdfParams.mCost ?? 65536, tCost: user.kdfParams.tCost ?? 3, pCost: user.kdfParams.pCost ?? 4 }
        : { type: "pbkdf2" as const, iterations: user.kdfParams.iterations ?? 600000 };

      // Derive old key material for auth hash
      const { authHash: oldHash } = await deriveLoginKeys(currentPw, user.email, kdfParams);

      // Derive new key material
      const { authHash: newHash, encKey, macKey } = await deriveLoginKeys(newPw, user.email, kdfParams);

      // Re-wrap user key with new stretched key
      const userKeyBytes = new Uint8Array([...userKey.encKey, ...userKey.macKey]);
      const newEncryptedUserKey = await wrapUserKey(userKeyBytes, { encKey, macKey });

      await changePassword(getApiClient(), {
        masterPasswordHash: toB64(oldHash),
        newMasterPasswordHash: toB64(newHash),
        key: newEncryptedUserKey,
      });

      setSuccess(true);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Change master password</h2>
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Current password</label>
          <input type="password" className={styles.formInput} value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" required />
        </div>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>New password</label>
          <input type="password" className={styles.formInput} value={newPw}
            onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" required />
        </div>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Confirm new password</label>
          <input type="password" className={styles.formInput} value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" required />
        </div>
        {error && <p className={styles.error}>{error}</p>}
        {success && <p className={styles.success}>✓ Password changed successfully</p>}
        <button type="submit" className={styles.btnPrimary} disabled={loading}>
          {loading ? "Changing…" : "Change password"}
        </button>
      </form>
    </section>
  );
}

// ─── TOTP 2FA ─────────────────────────────────────────────────────────────────

function TwoFactorSetup() {
  const { user } = useAuthStore();
  const [mode, setMode] = useState<"idle" | "setup" | "disable">("idle");
  const [totpKey, setTotpKey] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [currentPw, setCurrentPw] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function startSetup() {
    setLoading(true);
    setError(null);
    try {
      const res = await getTotpSetupKey(getApiClient());
      setTotpKey(res.key ?? null);
      if (res.key && user?.email) {
        setTotpUri(`otpauth://totp/NadSafe:${encodeURIComponent(user.email)}?secret=${res.key}&issuer=NadSafe`);
      }
      setMode("setup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start 2FA setup");
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable(e: FormEvent) {
    e.preventDefault();
    if (!totpKey || !user?.email) return;
    const kdfParams = user.kdfType === "argon2id"
      ? { type: "argon2id" as const, mCost: user.kdfParams.mCost ?? 65536, tCost: user.kdfParams.tCost ?? 3, pCost: user.kdfParams.pCost ?? 4 }
      : { type: "pbkdf2" as const, iterations: user.kdfParams.iterations ?? 600000 };

    setLoading(true);
    setError(null);
    try {
      const { authHash } = await deriveLoginKeys(currentPw, user.email, kdfParams);
      await enableTotp(getApiClient(), {
        masterPasswordHash: toB64(authHash),
        token: code,
        key: totpKey,
      });
      setSuccess("Two-factor authentication enabled");
      setMode("idle");
      setCurrentPw("");
      setCode("");
      setTotpKey(null);
      setTotpUri(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable 2FA");
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable(e: FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    const kdfParams = user.kdfType === "argon2id"
      ? { type: "argon2id" as const, mCost: user.kdfParams.mCost ?? 65536, tCost: user.kdfParams.tCost ?? 3, pCost: user.kdfParams.pCost ?? 4 }
      : { type: "pbkdf2" as const, iterations: user.kdfParams.iterations ?? 600000 };

    setLoading(true);
    setError(null);
    try {
      const { authHash } = await deriveLoginKeys(currentPw, user.email, kdfParams);
      await disableTotp(getApiClient(), {
        masterPasswordHash: toB64(authHash),
        type: 0,
      });
      setSuccess("Two-factor authentication disabled");
      setMode("idle");
      setCurrentPw("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable 2FA");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Two-factor authentication</h2>

      {mode === "idle" && (
        <div className={styles.row}>
          <div>
            <p className={styles.rowDesc}>Add an authenticator app (Google Authenticator, Authy, etc.) for extra security.</p>
            {success && <p className={styles.success}>{success}</p>}
            {error && <p className={styles.error}>{error}</p>}
          </div>
          <div className={styles.rowActions}>
            <button className={styles.btnSecondary} onClick={startSetup} disabled={loading}>
              {loading ? "Loading…" : "Set up authenticator"}
            </button>
            <button className={styles.btnDanger} onClick={() => { setMode("disable"); setError(null); }}>
              Disable 2FA
            </button>
          </div>
        </div>
      )}

      {mode === "setup" && (
        <form onSubmit={handleEnable} className={styles.form}>
          {totpUri && (
            <div className={styles.qrPlaceholder}>
              <p className={styles.qrLabel}>Scan with your authenticator app, or enter the key manually:</p>
              <code className={styles.totpKey}>{totpKey}</code>
              <p className={styles.qrUriHint}>
                Or use this URI:<br />
                <small className={styles.totpUri}>{totpUri}</small>
              </p>
              {totpKey && (
                <div style={{ marginTop: "var(--space-3)" }}>
                  <p className={styles.formLabel}>Live preview:</p>
                  <TotpDisplay secret={totpKey} />
                </div>
              )}
            </div>
          )}
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Master password (to confirm)</label>
            <input type="password" className={styles.formInput} value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)} required />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Authenticator code (6 digits)</label>
            <input type="text" className={styles.formInput} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000" autoComplete="one-time-code" required
              style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.3em" }} />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.rowActions}>
            <button type="button" className={styles.btnSecondary} onClick={() => setMode("idle")}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={loading || code.length !== 6}>
              {loading ? "Enabling…" : "Enable 2FA"}
            </button>
          </div>
        </form>
      )}

      {mode === "disable" && (
        <form onSubmit={handleDisable} className={styles.form}>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Master password</label>
            <input type="password" className={styles.formInput} value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)} required />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.rowActions}>
            <button type="button" className={styles.btnSecondary} onClick={() => setMode("idle")}>Cancel</button>
            <button type="submit" className={styles.btnDanger} disabled={loading}>
              {loading ? "Disabling…" : "Disable 2FA"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

function ExportSection() {
  const { items, folders } = useVaultStore();
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    if (!getSessionUserKey()) { setError("Vault is locked — unlock first"); return; }
    if (items.length === 0) { setError("No items to export — sync vault first"); return; }

    setLoading(true);
    setError(null);
    try {
      if (format === "json") {
        const json = buildExportJson(items, folders);
        downloadJson(json);
      } else {
        const csv = buildExportCsv(items);
        downloadCsv(csv);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Export vault</h2>
      <div className={styles.row}>
        <div>
          <p className={styles.rowDesc}>
            Download an unencrypted copy of your vault. Store it securely —
            anyone with this file can read your passwords.
          </p>
          {error && <p className={styles.error}>{error}</p>}
        </div>
        <div className={styles.rowActions}>
          <select className={styles.select} value={format} onChange={(e) => setFormat(e.target.value as "json" | "csv")}>
            <option value="json">Bitwarden JSON</option>
            <option value="csv">CSV (logins only)</option>
          </select>
          <button className={styles.btnWarning} onClick={handleExport} disabled={loading}>
            {loading ? "Exporting…" : "⬇ Export"}
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── Extension bridge ─────────────────────────────────────────────────────────

function ExtensionSection() {
  const { items } = useVaultStore();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  useEffect(() => {
    checkExtensionInstalled().then(setInstalled);
  }, []);

  async function handleSync() {
    if (!getSessionUserKey()) { setSyncResult("⚠ Vault locked"); return; }
    setSyncing(true);
    setSyncResult(null);
    try {
      await pushItemsToExtension(items);
      setSyncResult(`✓ ${items.length} items pushed to extension`);
    } catch (err) {
      setSyncResult(`⚠ ${err instanceof Error ? err.message : "Failed"}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 4000);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Browser extension</h2>
      <div className={styles.row}>
        <div>
          <p className={styles.rowDesc}>
            {installed === null
              ? "Checking for NadSafe extension…"
              : installed
              ? "✓ NadSafe extension detected. Click to push vault items for autofill."
              : "Extension not detected. Install NadSafe for Chrome/Firefox to enable autofill."}
          </p>
          {syncResult && <p className={installed ? styles.success : styles.error}>{syncResult}</p>}
        </div>
        <div className={styles.rowActions}>
          {installed === false && (
            <a
              href="https://github.com/nadiraff/nadsafe-password-manager#extension"
              target="_blank" rel="noopener noreferrer"
              className={styles.btnSecondary}
            >
              Get extension ↗
            </a>
          )}
          {installed && (
            <button className={styles.btnSecondary} onClick={handleSync} disabled={syncing}>
              {syncing ? "Syncing…" : "↑ Push to extension"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { user } = useAuthStore();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
      </header>

      <div className={styles.sections}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Account</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Email</span>
            <span className={styles.rowValue}>{user?.email}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Name</span>
            <span className={styles.rowValue}>{user?.name}</span>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Security</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>KDF algorithm</span>
            <span className={styles.rowValue}>{user?.kdfType === "argon2id" ? "Argon2id" : "PBKDF2-SHA256"}</span>
          </div>
          {user?.kdfType === "argon2id" && (
            <>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Memory (KiB)</span>
                <span className={styles.rowValue}>{user.kdfParams.mCost?.toLocaleString()}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Iterations</span>
                <span className={styles.rowValue}>{user.kdfParams.tCost}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Parallelism</span>
                <span className={styles.rowValue}>{user.kdfParams.pCost}</span>
              </div>
            </>
          )}
        </section>

        <ChangeMasterPassword />
        <TwoFactorSetup />
        <ExportSection />
        <ExtensionSection />

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>About</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Version</span>
            <span className={styles.rowValue}>0.1.0</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>License</span>
            <span className={styles.rowValue}>GPL-3.0-or-later</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Backend</span>
            <span className={styles.rowValue}>Vaultwarden 1.36 (self-hosted)</span>
          </div>
        </section>
      </div>
    </div>
  );
}
