import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { clearSessionKey, setSessionUserKey, setSessionRsaKey } from "../stores/session";
import { initApiClient } from "../lib/api/client";
import { prelogin, loginWithPassword, register, getOrCreateDeviceId } from "../lib/api/auth";
import { getTokenKey } from "../lib/api/types";
import {
  deriveLoginKeys,
  generateUserKey,
  wrapUserKey,
  unwrapUserKey,
} from "../lib/crypto/key-hierarchy";
import { generateRsaKeyPair, decryptRsaPrivateKey } from "../lib/crypto/rsa";
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
  if (!encryptedPrivateKey || encryptedPrivateKey.startsWith("2.placeholder")) return;
  try {
    const rsaKey = await decryptRsaPrivateKey(encryptedPrivateKey, userKey);
    setSessionRsaKey(rsaKey);
  } catch {
    // Non-fatal — org operations will fail gracefully
  }
}

export function useLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setServerUrl, login } = useAuthStore();
  const navigate = useNavigate();

  const doLogin = useCallback(
    async (serverUrl: string, email: string, password: string) => {
      setLoading(true);
      setError(null);
      try {
        const cleanUrl = serverUrl.replace(/\/$/, "");
        setServerUrl(cleanUrl);
        const client = initApiClient(cleanUrl);

        const preloginRes = await prelogin(client, email);
        const kdfParams = serverKdfToParams(preloginRes);

        const { authHash, encKey, macKey } = await deriveLoginKeys(password, email, kdfParams);

        const deviceId = getOrCreateDeviceId();
        const tokenRes = await loginWithPassword(client, email, authHash, deviceId);
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
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login failed");
      } finally {
        setLoading(false);
      }
    },
    [login, setServerUrl, navigate],
  );

  return { doLogin, loading, error };
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

        // Generate recovery entropy — shown to user before navigating to vault
        const { generateRecoveryEntropy } = await import("../lib/crypto/recovery");
        const entropy = generateRecoveryEntropy();
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
  const { logout } = useAuthStore();
  const navigate = useNavigate();
  return useCallback(() => {
    clearSessionKey();
    logout();
    navigate("/login");
  }, [logout, navigate]);
}
