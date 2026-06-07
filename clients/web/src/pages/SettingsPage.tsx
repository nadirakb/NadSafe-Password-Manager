import { useState, useEffect, type FormEvent } from "react";
import { useAuthStore } from "../stores/auth";
import { getApiClient } from "../lib/api/client";
import { getVaultTimeoutMinutes, setVaultTimeoutMinutes } from "../hooks/useVaultTimeout";
import { passwordStrength } from "../lib/password-strength";
import { changePassword, getTotpSetupKey, enableTotp, disableTotp, getProfile, getWebAuthnCredentials, registerWebAuthn, deleteWebAuthn } from "../lib/api/account";
import { useVaultStore } from "../stores/vault";
import { getSessionUserKey } from "../stores/session";
import { deriveLoginKeys, wrapUserKey } from "../lib/crypto/key-hierarchy";
import { toB64 } from "../lib/crypto/utils";
import { buildExportJson, buildExportCsv, downloadJson, downloadCsv } from "../lib/export";
import { checkExtensionInstalled, pushItemsToExtension } from "../lib/extension-bridge";
import { TotpDisplay } from "../components/TotpDisplay";
import styles from "./Settings.module.css";

// ─── Vault Timeout ───────────────────────────────────────────────────────────

const TIMEOUT_OPTIONS = [
  { label: "1 minute", value: 1 },
  { label: "5 minutes", value: 5 },
  { label: "15 minutes (default)", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "4 hours", value: 240 },
  { label: "Never", value: 0 },
];

function VaultTimeoutSection() {
  const [minutes, setMinutes] = useState(getVaultTimeoutMinutes);
  const [saved, setSaved] = useState(false);

  function handleChange(v: number) {
    setMinutes(v);
    setVaultTimeoutMinutes(v);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Vault timeout</h2>
      <div className={styles.row}>
        <div>
          <span className={styles.rowLabel}>Auto-lock after inactivity</span>
          <p className={styles.rowDesc}>Lock the vault automatically after the chosen idle period.</p>
        </div>
        <div className={styles.rowActions}>
          <select
            className={styles.select}
            value={minutes}
            onChange={(e) => handleChange(Number(e.target.value))}
          >
            {TIMEOUT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {saved && <span className={styles.success}>Saved</span>}
        </div>
      </div>
    </section>
  );
}

// ─── Change Master Password ───────────────────────────────────────────────────

function ChangeMasterPassword() {
  const { user, encryptedUserKey } = useAuthStore();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = passwordStrength(newPw);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPw !== confirmPw) { setError("New passwords do not match"); return; }
    if (strength.score < 2) { setError("New password is too weak — add length, mixed case, numbers or symbols"); return; }
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
          {newPw && (
            <div style={{ marginTop: "var(--space-1)" }}>
              <div style={{ height: 4, borderRadius: 2, background: "var(--color-border)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 2, width: `${(strength.score / 5) * 100}%`, background: strength.color, transition: "width 0.2s, background 0.2s" }} />
              </div>
              <span style={{ fontSize: "var(--font-size-xs)", color: strength.color }}>{strength.label}</span>
            </div>
          )}
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
  // "setup-pw" = collect password first; "setup-key" = show QR + confirm code
  const [mode, setMode] = useState<"idle" | "setup-pw" | "setup-key" | "disable">("idle");
  const [totpKey, setTotpKey] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [currentPw, setCurrentPw] = useState("");
  const [authHashB64, setAuthHashB64] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    getProfile(getApiClient())
      .then((p) => setTotpEnabled(p.twoFactorEnabled))
      .catch(() => setTotpEnabled(false));
  }, []);

  function resetSetup() {
    setMode("idle");
    setCurrentPw("");
    setAuthHashB64(null);
    setCode("");
    setTotpKey(null);
    setTotpUri(null);
    setError(null);
  }

  function kdfParams() {
    return user?.kdfType === "argon2id"
      ? { type: "argon2id" as const, mCost: user.kdfParams.mCost ?? 65536, tCost: user.kdfParams.tCost ?? 3, pCost: user.kdfParams.pCost ?? 4 }
      : { type: "pbkdf2" as const, iterations: user?.kdfParams.iterations ?? 600000 };
  }

  async function handleGetKey(e: FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    setLoading(true);
    setError(null);
    try {
      const { authHash } = await deriveLoginKeys(currentPw, user.email, kdfParams());
      const hash = toB64(authHash);
      const res = await getTotpSetupKey(getApiClient(), hash);
      setAuthHashB64(hash);
      setTotpKey(res.key ?? null);
      if (res.key) {
        setTotpUri(`otpauth://totp/NadSafe:${encodeURIComponent(user.email)}?secret=${res.key}&issuer=NadSafe`);
      }
      setMode("setup-key");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start 2FA setup");
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable(e: FormEvent) {
    e.preventDefault();
    if (!totpKey || !authHashB64) return;
    setLoading(true);
    setError(null);
    try {
      await enableTotp(getApiClient(), {
        masterPasswordHash: authHashB64,
        token: code,
        key: totpKey,
      });
      setSuccess("Two-factor authentication enabled");
      setTotpEnabled(true);
      resetSetup();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable 2FA");
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable(e: FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    setLoading(true);
    setError(null);
    try {
      const { authHash } = await deriveLoginKeys(currentPw, user.email, kdfParams());
      await disableTotp(getApiClient(), {
        masterPasswordHash: toB64(authHash),
        type: 0,
      });
      setSuccess("Two-factor authentication disabled");
      setTotpEnabled(false);
      resetSetup();
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
            {totpEnabled !== true && (
              <button className={styles.btnSecondary} onClick={() => { setMode("setup-pw"); setError(null); }}>
                Set up authenticator
              </button>
            )}
            {totpEnabled === true && (
              <button className={styles.btnDanger} onClick={() => { setMode("disable"); setError(null); }}>
                Disable 2FA
              </button>
            )}
          </div>
        </div>
      )}

      {mode === "setup-pw" && (
        <form onSubmit={handleGetKey} className={styles.form}>
          <p className={styles.rowDesc}>Enter your master password to generate a setup key.</p>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Master password</label>
            <input type="password" className={styles.formInput} value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)} required autoFocus />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.rowActions}>
            <button type="button" className={styles.btnSecondary} onClick={resetSetup}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={loading || !currentPw}>
              {loading ? "Loading…" : "Get setup key"}
            </button>
          </div>
        </form>
      )}

      {mode === "setup-key" && (
        <form onSubmit={handleEnable} className={styles.form}>
          <div className={styles.qrPlaceholder}>
            <p className={styles.qrLabel}>Scan with your authenticator app, or enter the key manually:</p>
            <code className={styles.totpKey}>{totpKey}</code>
            {totpUri && (
              <p className={styles.qrUriHint}>
                Or use this URI:<br />
                <small className={styles.totpUri}>{totpUri}</small>
              </p>
            )}
            {totpKey && (
              <div style={{ marginTop: "var(--space-3)" }}>
                <p className={styles.formLabel}>Live preview:</p>
                <TotpDisplay secret={totpKey} />
              </div>
            )}
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
            <button type="button" className={styles.btnSecondary} onClick={resetSetup}>Cancel</button>
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
              onChange={(e) => setCurrentPw(e.target.value)} required autoFocus />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.rowActions}>
            <button type="button" className={styles.btnSecondary} onClick={resetSetup}>Cancel</button>
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

// ─── WebAuthn / FIDO2 ─────────────────────────────────────────────────────────

function WebAuthnSection() {
  const { user } = useAuthStore();
  const [credentials, setCredentials] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [masterPw, setMasterPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    getWebAuthnCredentials(getApiClient())
      .then((res) => setCredentials(res.credentials ?? []))
      .catch(() => setCredentials([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    const kdfParams = user.kdfType === "argon2id"
      ? { type: "argon2id" as const, mCost: user.kdfParams.mCost ?? 65536, tCost: user.kdfParams.tCost ?? 3, pCost: user.kdfParams.pCost ?? 4 }
      : { type: "pbkdf2" as const, iterations: user.kdfParams.iterations ?? 600000 };

    setRegistering(true);
    setError(null);
    try {
      const { authHash } = await deriveLoginKeys(masterPw, user.email, kdfParams);

      // Get WebAuthn creation options from server
      const setup = await getWebAuthnCredentials(getApiClient());
      if (!setup.options) throw new Error("Server did not return WebAuthn creation options");

      const opts = JSON.parse(atob(setup.options)) as PublicKeyCredentialCreationOptions;
      // Convert base64url challenge/user.id to ArrayBuffer
      opts.challenge = base64UrlToBuffer(opts.challenge as unknown as string);
      if (opts.user?.id) opts.user.id = base64UrlToBuffer(opts.user.id as unknown as string);

      const credential = await navigator.credentials.create({
        publicKey: opts,
      }) as PublicKeyCredential | null;

      if (!credential) throw new Error("WebAuthn credential creation cancelled");

      const res = credential.response as AuthenticatorAttestationResponse;
      const tokenPayload = btoa(JSON.stringify({
        id: credential.id,
        rawId: bufferToBase64Url(credential.rawId),
        response: {
          attestationObject: bufferToBase64Url(res.attestationObject),
          clientDataJSON: bufferToBase64Url(res.clientDataJSON),
        },
        type: credential.type,
      }));

      const result = await registerWebAuthn(getApiClient(), {
        masterPasswordHash: toB64(authHash),
        token: tokenPayload,
        name: keyName || "Security key",
      });

      setCredentials(result.credentials ?? []);
      setSuccess("Security key registered successfully");
      setShowForm(false);
      setKeyName("");
      setMasterPw("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setRegistering(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove security key "${name}"?`)) return;
    if (!user?.email) return;
    const pw = prompt("Enter your master password to confirm:");
    if (!pw) return;

    const kdfParams = user.kdfType === "argon2id"
      ? { type: "argon2id" as const, mCost: user.kdfParams.mCost ?? 65536, tCost: user.kdfParams.tCost ?? 3, pCost: user.kdfParams.pCost ?? 4 }
      : { type: "pbkdf2" as const, iterations: user.kdfParams.iterations ?? 600000 };

    try {
      const { authHash } = await deriveLoginKeys(pw, user.email, kdfParams);
      await deleteWebAuthn(getApiClient(), { masterPasswordHash: toB64(authHash), id: parseInt(id) });
      setCredentials((prev) => prev.filter((c) => c.id !== id));
      setSuccess("Security key removed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const webAuthnSupported = typeof window !== "undefined" && !!window.PublicKeyCredential;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Security keys (FIDO2 / WebAuthn)</h2>
      {loading && <div className={styles.row}><p className={styles.rowDesc}>Loading…</p></div>}

      {!webAuthnSupported && (
        <div className={styles.row}>
          <p className={styles.rowDesc}>WebAuthn not supported in this browser.</p>
        </div>
      )}

      {webAuthnSupported && !loading && (
        <>
          {credentials.length === 0 && !showForm && (
            <div className={styles.row}>
              <p className={styles.rowDesc}>No security keys registered. Add a hardware key (YubiKey, Passkey, etc.) for stronger 2FA.</p>
              <button className={styles.btnSecondary} onClick={() => setShowForm(true)}>+ Add security key</button>
            </div>
          )}

          {credentials.map((c) => (
            <div key={c.id} className={styles.row}>
              <div>
                <span className={styles.rowValue}>🔑 {c.name}</span>
              </div>
              <button className={styles.btnDanger} onClick={() => handleDelete(c.id, c.name)}>Remove</button>
            </div>
          ))}

          {credentials.length > 0 && (
            <div className={styles.row}>
              <span />
              <button className={styles.btnSecondary} onClick={() => setShowForm(true)}>+ Add another key</button>
            </div>
          )}

          {showForm && (
            <form onSubmit={handleRegister} className={styles.form}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Key name</label>
                <input className={styles.formInput} value={keyName}
                  onChange={(e) => setKeyName(e.target.value)} placeholder="YubiKey 5" />
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Master password (to confirm)</label>
                <input type="password" className={styles.formInput} value={masterPw}
                  onChange={(e) => setMasterPw(e.target.value)} required />
              </div>
              {error && <p className={styles.error}>{error}</p>}
              <div className={styles.rowActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className={styles.btnPrimary} disabled={registering}>
                  {registering ? "Tap your key…" : "Register key"}
                </button>
              </div>
            </form>
          )}

          {success && <p className={styles.success} style={{ padding: "0 var(--space-5)" }}>{success}</p>}
        </>
      )}
    </section>
  );
}

function base64UrlToBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

function bufferToBase64Url(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf);
  let bin = "";
  arr.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
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

        <VaultTimeoutSection />
        <ChangeMasterPassword />
        <TwoFactorSetup />
        <WebAuthnSection />
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
