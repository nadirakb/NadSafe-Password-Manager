import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { setSessionUserKey, setSessionRsaKey } from "../stores/session";
import { logoutAndClear } from "../stores/lock";
import { initApiClient } from "../lib/api/client";
import { prelogin, loginWithPassword, register, getOrCreateDeviceId, TwoFactorRequiredError } from "../lib/api/auth";
import { getTokenKey } from "../lib/api/types";
import { fetchUserPolicies, PolicyType } from "../lib/api/orgs";
import {
  deriveLoginKeys,
  generateUserKey,
  wrapUserKey,
  unwrapUserKey,
} from "../lib/crypto/key-hierarchy";
import { generateRsaKeyPair, decryptRsaPrivateKey } from "../lib/crypto/rsa";
import { generateRecoveryEntropy, wrapUserKeyWithRecovery } from "../lib/crypto/recovery";
import { symKeyFromBytes } from "../lib/crypto/types";
import { toB64 } from "../lib/crypto/utils";
// symKeyFromBytes used in doRegister only
import type { KdfParams } from "../lib/crypto/types";

function serverKdfToParams(res: {
  kdf: number;
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
}): KdfParams {
  if (res.kdf === 1) {
    // Vaultwarden 1.32+ returns kdfMemory in MB; convert to KiB for our crypto layer
    const mCostMB = res.kdfMemory ?? 64;
    return {
      type: "argon2id",
      mCost: mCostMB * 1024,
      tCost: res.kdfIterations,
      pCost: res.kdfParallelism ?? 4,
    };
  }
  return { type: "pbkdf2", iterations: res.kdfIterations };
}

/** After obtaining the user key, also decrypt and cache the RSA private key. */
async function restoreRsaKey(
  encryptedPrivateKey: string | null | undefined,
  userKey: import("../lib/crypto/types").SymKey,
): Promise<void> {
  // EncString format: "{type}.{iv}|{ciphertext}|{mac}" — must contain "|"
  // Rejects null, empty, and legacy placeholder values (e.g. "2.placeholder")
  if (!encryptedPrivateKey || !encryptedPrivateKey.includes("|")) return;
  try {
    const rsaKey = await decryptRsaPrivateKey(encryptedPrivateKey, userKey);
    setSessionRsaKey(rsaKey);
  } catch {
    // Non-fatal — org operations will fail gracefully
  }
}

interface PendingLogin {
  cleanUrl: string;
  email: string;
  authHash: Uint8Array;
  encKey: Uint8Array;
  macKey: Uint8Array;
  kdfParams: KdfParams;
}

export function useLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const { setServerUrl, login, setRequires2FASetup } = useAuthStore();
  const navigate = useNavigate();

  // Cache derived key material between the initial login and 2FA confirmation step
  // (Argon2id is expensive; no reason to re-run it for the 2FA retry)
  const pendingLogin = useRef<PendingLogin | null>(null);

  /** Returns true when login fully succeeded (tokens stored, vault key unwrapped). */
  const doLogin = useCallback(
    async (serverUrl: string, email: string, password: string, twoFactorToken?: string): Promise<boolean> => {
      setLoading(true);
      setError(null);
      try {
        const cleanUrl = serverUrl.replace(/\/$/, "");
        setServerUrl(cleanUrl);
        const client = initApiClient(cleanUrl);

        // Reuse cached key material if this is the 2FA retry
        let authHash: Uint8Array;
        let encKey: Uint8Array;
        let macKey: Uint8Array;
        let kdfParams: KdfParams;

        if (
          twoFactorToken &&
          pendingLogin.current?.cleanUrl === cleanUrl &&
          pendingLogin.current.email === email
        ) {
          ({ authHash, encKey, macKey, kdfParams } = pendingLogin.current);
        } else {
          const preloginRes = await prelogin(client, email);
          kdfParams = serverKdfToParams(preloginRes);
          ({ authHash, encKey, macKey } = await deriveLoginKeys(password, email, kdfParams));
        }

        const deviceId = getOrCreateDeviceId();
        let tokenRes;
        try {
          tokenRes = await loginWithPassword(client, email, authHash, deviceId, twoFactorToken);
        } catch (err) {
          if (err instanceof TwoFactorRequiredError) {
            // Cache key material; show TOTP input
            pendingLogin.current = { cleanUrl, email, authHash, encKey, macKey, kdfParams };
            setNeedsTwoFactor(true);
            return false;
          }
          throw err;
        }
        pendingLogin.current = null;
        setNeedsTwoFactor(false);
        client.setToken(tokenRes.access_token);

        const encUserKey = getTokenKey(tokenRes);
        if (!encUserKey) throw new Error("Server did not return vault key");
        const userKey = await unwrapUserKey(encUserKey, { encKey, macKey });
        setSessionUserKey(userKey);

        // Decrypt RSA private key for org operations
        const encPrivKey = tokenRes.PrivateKey ?? tokenRes.privateKey;
        await restoreRsaKey(encPrivKey, userKey);

        login(
          {
            id: "pending-from-sync",
            email,
            name: email.split("@")[0],
            kdfType: kdfParams.type,
            kdfParams:
              kdfParams.type === "argon2id"
                ? { mCost: kdfParams.mCost, tCost: kdfParams.tCost, pCost: kdfParams.pCost }
                : { iterations: kdfParams.iterations },
          },
          tokenRes.access_token,
          tokenRes.refresh_token,
          encUserKey,
          tokenRes.PrivateKey ?? tokenRes.privateKey ?? null,
        );

        navigate("/vault");

        // Check org 2FA policy: if any org requires 2FA and user didn't use it, flag it.
        // Non-blocking — fires after navigation (server won't block login either).
        fetchUserPolicies(client).then((policies) => {
          const needs2FA = policies.some(
            (p) => p.type === PolicyType.TwoFactorAuthentication && p.enabled,
          );
          // If org requires 2FA but the user logged in without 2FA prompt, they haven't set it up.
          setRequires2FASetup(needs2FA && !twoFactorToken);
        }).catch(() => null);

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login failed");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [login, setServerUrl, navigate, setRequires2FASetup],
  );

  return { doLogin, loading, error, needsTwoFactor, setNeedsTwoFactor };
}

export function useRegister() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryEntropy, setRecoveryEntropy] = useState<Uint8Array | null>(null);
  const { setServerUrl, login } = useAuthStore();
  const navigate = useNavigate();

  const doRegister = useCallback(
    async (serverUrl: string, email: string, name: string, password: string) => {
      setLoading(true);
      setError(null);
      try {
        const cleanUrl = serverUrl.replace(/\/$/, "");
        setServerUrl(cleanUrl);
        const client = initApiClient(cleanUrl);

        const kdfParams: KdfParams = { type: "argon2id", mCost: 65536, tCost: 3, pCost: 4 };
        const { authHash, encKey, macKey } = await deriveLoginKeys(password, email, kdfParams);

        const userKeyBytes = generateUserKey();
        const encryptedUserKey = await wrapUserKey(userKeyBytes, { encKey, macKey });

        // Generate real RSA-2048 key pair for org key sharing
        const userSymKey = symKeyFromBytes(new Uint8Array([...userKeyBytes]));
        const { publicKeyBase64, encryptedPrivateKey } = await generateRsaKeyPair(userSymKey);

        await register(client, {
          email,
          name,
          masterPasswordHash: toB64(authHash),
          key: encryptedUserKey,
          kdf: 1,
          kdfIterations: kdfParams.tCost,
          kdfMemory: Math.round(kdfParams.mCost / 1024), // MB
          kdfParallelism: kdfParams.pCost,
          keys: {
            publicKey: publicKeyBase64,
            encryptedPrivateKey,
          },
        });

        const deviceId = getOrCreateDeviceId();
        const tokenRes = await loginWithPassword(client, email, authHash, deviceId);
        client.setToken(tokenRes.access_token);

        const regTokenKey = getTokenKey(tokenRes);
        if (!regTokenKey) throw new Error("Server did not return vault key after registration");
        const userKey = await unwrapUserKey(regTokenKey, { encKey, macKey });
        setSessionUserKey(userKey);

        // Cache RSA private key in session
        await restoreRsaKey(encryptedPrivateKey, userKey);

        login(
          {
            id: "pending-from-sync",
            email,
            name,
            kdfType: "argon2id",
            kdfParams: { mCost: 65536, tCost: 3, pCost: 4 },
          },
          tokenRes.access_token,
          tokenRes.refresh_token,
          regTokenKey,
          encryptedPrivateKey,
        );

        // Generate recovery entropy; wrap user key with it; persist to localStorage
        // (device-local — recovery only works on same device unless user notes the phrase)
        const entropy = generateRecoveryEntropy();
        const wrappedRecoveryKey = await wrapUserKeyWithRecovery(userKey, entropy);
        const rkStorageKey = `ns_rk:${cleanUrl}|${email}`;
        localStorage.setItem(rkStorageKey, wrappedRecoveryKey);
        setRecoveryEntropy(entropy);
        // Navigation happens after user dismisses recovery phrase modal
      } catch (err) {
        setError(err instanceof Error ? err.message : "Registration failed");
      } finally {
        setLoading(false);
      }
    },
    [login, setServerUrl],
  );

  function dismissRecovery() {
    setRecoveryEntropy(null);
    navigate("/vault");
  }

  return { doRegister, loading, error, recoveryEntropy, dismissRecovery };
}

export function useLogout() {
  const navigate = useNavigate();
  return useCallback(() => {
    logoutAndClear();
    navigate("/login");
  }, [navigate]);
}
