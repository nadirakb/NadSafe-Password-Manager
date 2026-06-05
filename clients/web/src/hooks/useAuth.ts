import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { clearSessionKey, setSessionUserKey } from "../stores/session";
import { initApiClient } from "../lib/api/client";
import { prelogin, loginWithPassword, register, getOrCreateDeviceId } from "../lib/api/auth";
import {
  deriveLoginKeys,
  generateUserKey,
  wrapUserKey,
  unwrapUserKey,
} from "../lib/crypto/key-hierarchy";
import { toB64 } from "../lib/crypto/utils";
import type { KdfParams } from "../lib/crypto/types";

function serverKdfToParams(res: { kdf: number; kdfIterations: number; kdfMemory?: number; kdfParallelism?: number }): KdfParams {
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

        // 1. Fetch KDF params
        const preloginRes = await prelogin(client, email);
        const kdfParams = serverKdfToParams(preloginRes);

        // 2. Derive keys
        const { authHash, encKey, macKey } = await deriveLoginKeys(password, email, kdfParams);

        // 3. Authenticate
        const deviceId = getOrCreateDeviceId();
        const tokenRes = await loginWithPassword(client, email, authHash, deviceId);

        // 4. Set token on client
        client.setToken(tokenRes.access_token);

        // 5. Unwrap user key
        const userKey = await unwrapUserKey(tokenRes.Key, { encKey, macKey });

        // 6. Store in-memory session key (never persisted)
        setSessionUserKey(userKey);

        // 7. Update auth store
        login(
          {
            id: "pending-from-sync",
            email,
            name: email.split("@")[0],
            kdfType: kdfParams.type,
            kdfParams: kdfParams.type === "argon2id"
              ? { mCost: kdfParams.mCost, tCost: kdfParams.tCost, pCost: kdfParams.pCost }
              : { iterations: kdfParams.iterations },
          },
          tokenRes.access_token,
          tokenRes.refresh_token,
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

        // Default to Argon2id
        const kdfParams: KdfParams = { type: "argon2id", mCost: 65536, tCost: 3, pCost: 4 };
        const { authHash, encKey, macKey } = await deriveLoginKeys(password, email, kdfParams);

        // Generate user key and wrap it
        const userKeyBytes = generateUserKey();
        const encryptedUserKey = await wrapUserKey(userKeyBytes, { encKey, macKey });

        // TODO: generate RSA key pair for org key sharing — placeholder for now
        const rsaPublicKey = toB64(new Uint8Array(32)); // placeholder
        const rsaEncPrivateKey = "2.placeholder|placeholder|placeholder";

        await register(client, {
          email,
          name,
          masterPasswordHash: toB64(authHash),
          key: encryptedUserKey,
          kdf: 1, // argon2id
          kdfIterations: kdfParams.tCost,
          // Vaultwarden 1.32+ expects kdfMemory in MB, not KiB
          kdfMemory: Math.round(kdfParams.mCost / 1024),
          kdfParallelism: kdfParams.pCost,
          keys: {
            publicKey: rsaPublicKey,
            encryptedPrivateKey: rsaEncPrivateKey,
          },
        });

        // Auto-login after registration
        const deviceId = getOrCreateDeviceId();
        const tokenRes = await loginWithPassword(client, email, authHash, deviceId);
        client.setToken(tokenRes.access_token);

        const userKey = await unwrapUserKey(tokenRes.Key, { encKey, macKey });
        setSessionUserKey(userKey);

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
        );

        navigate("/vault");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Registration failed");
      } finally {
        setLoading(false);
      }
    },
    [login, setServerUrl, navigate],
  );

  return { doRegister, loading, error };
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
