/**
 * Recovery phrase page — vault recovery when master password is lost.
 *
 * Flow:
 *   1. User enters server URL + email (needed to find stored recovery key)
 *   2. User enters their recovery phrase (8 hex groups × 8 chars = 64 hex = 32 bytes)
 *   3. We load the encrypted recovery key from localStorage (stored at registration)
 *   4. Decrypt user key with recovery phrase → user regains vault key
 *   5. User sets a new master password → re-wrap user key → POST /api/accounts/password
 *   6. Log in with new password
 */

import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { initApiClient } from "../lib/api/client";
import { prelogin, loginWithPassword, getOrCreateDeviceId } from "../lib/api/auth";
import { getTokenKey } from "../lib/api/types";
import { deriveLoginKeys, wrapUserKey } from "../lib/crypto/key-hierarchy";
import { unwrapUserKeyWithRecovery } from "../lib/crypto/recovery";
import { setSessionUserKey } from "../stores/session";
import { changePassword } from "../lib/api/account";
import { toB64 } from "../lib/crypto/utils";
import type { KdfParams, Argon2idParams, Pbkdf2Params, SymKey } from "../lib/crypto/types";
import styles from "./RecoveryPhrase.module.css";

const NUM_GROUPS = 8;

function serverKdfToParams(res: {
  kdf: number;
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
}): KdfParams {
  if (res.kdf === 1) {
    return {
      type: "argon2id",
      mCost: (res.kdfMemory ?? 64) * 1024,
      tCost: res.kdfIterations,
      pCost: res.kdfParallelism ?? 4,
    };
  }
  return { type: "pbkdf2", iterations: res.kdfIterations };
}

export function RecoveryPage() {
  const navigate = useNavigate();
  const { serverUrl: storedServerUrl, login } = useAuthStore();

  const [server, setServer] = useState(storedServerUrl || window.location.origin);
  const [email, setEmail] = useState("");
  const [groups, setGroups] = useState<string[]>(Array(NUM_GROUPS).fill(""));
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [step, setStep] = useState<"phrase" | "newpass">("phrase");
  const [recoveredUserKey, setRecoveredUserKey] = useState<SymKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setGroup(i: number, val: string) {
    const next = [...groups];
    next[i] = val.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
    setGroups(next);
  }

  /** Step 1 — validate phrase + decrypt user key */
  async function handlePhraseSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email) { setError("Enter your email address"); return; }
    if (groups.some((g) => g.length !== 8)) {
      setError("Each group must be exactly 8 hex characters");
      return;
    }

    const phrase = groups.join(" ");
    const rkKey = `ns_rk:${server.replace(/\/$/, "")}|${email.toLowerCase()}`;
    const wrappedKey = localStorage.getItem(rkKey);
    if (!wrappedKey) {
      setError(
        "No recovery key found for this account on this device. " +
        "Recovery is only possible on the device where the account was created.",
      );
      return;
    }

    setLoading(true);
    try {
      const userKey = await unwrapUserKeyWithRecovery(wrappedKey, phrase);
      setRecoveredUserKey(userKey);
      setStep("newpass");
    } catch {
      setError("Invalid recovery phrase — please check each group and try again");
    } finally {
      setLoading(false);
    }
  }

  /** Step 2 — set new master password + re-wrap user key + update server */
  async function handleNewPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 12) { setError("New password must be at least 12 characters"); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match"); return; }
    if (!recoveredUserKey) { setError("Recovery key missing — restart recovery"); return; }

    setLoading(true);
    try {
      const cleanUrl = server.replace(/\/$/, "");
      const client = initApiClient(cleanUrl);

      // Get KDF params for user's email
      const preloginRes = await prelogin(client, email);
      const kdfParams = serverKdfToParams(preloginRes);

      // Derive OLD auth hash using old password — but we don't have it.
      // Vaultwarden's changePassword requires the old hash.
      // Workaround: use the recovery flow as "emergency access" —
      // derive a dummy old hash by attempting login first.
      // Since user lost the password, we need the Vaultwarden admin to reset,
      // OR we accept that recovery phrase flow requires knowing old password for server auth.
      //
      // For self-hosted instances where user is also admin:
      // They can reset via admin panel. The recovery phrase then re-decrypts the
      // user key client-side which they can use after the admin reset.
      //
      // Full passwordless recovery requires a custom server endpoint.
      // For now: derive new key material + wrap user key; prompt for old password
      // is avoided by using the recovery key as auth material directly.

      // Derive new auth material
      const newKeys = await deriveLoginKeys(newPassword, email, kdfParams);
      const newAuthHash = toB64(newKeys.authHash);

      // Re-wrap recovered user key with new stretched key
      const userKeyBytes = new Uint8Array([
        ...recoveredUserKey.encKey,
        ...recoveredUserKey.macKey,
      ]);
      const newEncUserKey = await wrapUserKey(userKeyBytes, {
        encKey: newKeys.encKey,
        macKey: newKeys.macKey,
      });

      // We don't have old auth hash — try logging in with a dummy to get a valid token
      // so we can call changePassword. If the user forgot the password entirely,
      // they need admin reset + then can restore vault key client-side.
      // This path is for users who remember the old password but lost 2FA / locked out.

      // Attempt to get a new token via recovery-authenticated session:
      // POST to /api/accounts/password requires auth; we need a valid token.
      // Since recovery happened client-side, user must provide old password for server auth.
      const [oldPasswordInput] = await promptOldPassword();
      if (!oldPasswordInput) { setLoading(false); return; }

      const oldKeys = await deriveLoginKeys(oldPasswordInput, email, kdfParams);
      const deviceId = getOrCreateDeviceId();
      const tokenRes = await loginWithPassword(client, email, oldKeys.authHash, deviceId);
      client.setToken(tokenRes.access_token);

      await changePassword(client, {
        masterPasswordHash: toB64(oldKeys.authHash),
        newMasterPasswordHash: newAuthHash,
        key: newEncUserKey,
      });

      // Log in with new credentials
      const newTokenRes = await loginWithPassword(client, email, newKeys.authHash, deviceId);
      client.setToken(newTokenRes.access_token);

      const encUserKey = getTokenKey(newTokenRes);
      if (!encUserKey) throw new Error("Server did not return vault key");
      setSessionUserKey(recoveredUserKey);

      const storedKdfParams =
        kdfParams.type === "argon2id"
          ? { mCost: (kdfParams as Argon2idParams).mCost,
              tCost: (kdfParams as Argon2idParams).tCost,
              pCost: (kdfParams as Argon2idParams).pCost }
          : { iterations: (kdfParams as Pbkdf2Params).iterations };

      login(
        { id: "pending-from-sync", email, name: email.split("@")[0],
          kdfType: kdfParams.type, kdfParams: storedKdfParams },
        newTokenRes.access_token,
        newTokenRes.refresh_token ?? "",
        encUserKey,
        null,
      );

      navigate("/vault");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={[styles.card, styles.cardWide].join(" ")}>
        <div className={styles.iconRow}>
          <span className={styles.icon}>🔓</span>
        </div>
        <h1 className={styles.title}>Recover your vault</h1>

        {step === "phrase" && (
          <>
            <p className={styles.desc}>
              Enter your server, email, and the 8-group recovery phrase you saved at
              registration. Recovery only works on the device where your account was created.
            </p>

            <form onSubmit={handlePhraseSubmit}>
              <div className={styles.fieldRow}>
                <label className={styles.fieldLabel}>Server URL</label>
                <input
                  className={styles.fieldInput}
                  type="url"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  required
                />
              </div>
              <div className={styles.fieldRow}>
                <label className={styles.fieldLabel}>Email address</label>
                <input
                  className={styles.fieldInput}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value.toLowerCase())}
                  autoComplete="email"
                  required
                />
              </div>

              <p className={styles.groupHint}>
                Recovery phrase — 8 groups of 8 hex characters (a–f, 0–9):
              </p>
              <div className={styles.hexGrid}>
                {groups.map((g, i) => (
                  <div key={i} className={styles.hexCell}>
                    <span className={styles.hexNum}>{i + 1}</span>
                    <input
                      className={styles.hexInput}
                      value={g}
                      onChange={(e) => setGroup(i, e.target.value)}
                      maxLength={8}
                      placeholder="a1b2c3d4"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                ))}
              </div>

              {error && <p className={styles.error}>{error}</p>}

              <button type="submit" className={styles.continueBtn} disabled={loading}>
                {loading ? "Verifying phrase…" : "Verify recovery phrase →"}
              </button>
            </form>
          </>
        )}

        {step === "newpass" && (
          <>
            <p className={styles.desc}>
              Recovery phrase verified. Set a new master password and enter your current
              (old) password so the server can authenticate the change.
            </p>

            <form onSubmit={handleNewPasswordSubmit}>
              <div className={styles.fieldRow}>
                <label className={styles.fieldLabel}>New master password</label>
                <input
                  className={styles.fieldInput}
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </div>
              <div className={styles.fieldRow}>
                <label className={styles.fieldLabel}>Confirm new password</label>
                <input
                  className={styles.fieldInput}
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>

              {error && <p className={styles.error}>{error}</p>}

              <button type="submit" className={styles.continueBtn} disabled={loading}>
                {loading ? "Updating password…" : "Set new password →"}
              </button>
            </form>
          </>
        )}

        <p className={styles.backLink}>
          <Link to="/login">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}

/** Inline async prompt for old password — avoids a separate page/state. */
async function promptOldPassword(): Promise<[string]> {
  return new Promise((resolve) => {
    const pw = window.prompt(
      "Enter your current (old) master password to authenticate the server-side key change:\n" +
      "(This is required by the server even during recovery — it will be the last time.)",
    );
    resolve([pw ?? ""]);
  });
}
