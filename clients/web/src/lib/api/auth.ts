import { toB64 } from "../crypto/utils";
import type { PreloginResponse, RegisterRequest, TokenResponse } from "./types";
import type { ApiClient } from "./client";

/** Step 1 of login: get the KDF parameters for the user's email. */
export async function prelogin(
  client: ApiClient,
  email: string,
): Promise<PreloginResponse> {
  return client.post<PreloginResponse>(
    "/api/accounts/prelogin",
    { email },
    { noAuth: true },
  );
}

/** Step 2: exchange auth hash for tokens. */
export async function loginWithPassword(
  client: ApiClient,
  email: string,
  authHashBytes: Uint8Array,
  deviceId: string,
): Promise<TokenResponse> {
  const passwordHash = toB64(authHashBytes);

  return client.post<TokenResponse>(
    "/identity/connect/token",
    {
      grant_type: "password",
      username: email,
      password: passwordHash,
      scope: "api offline_access",
      client_id: "web",
      deviceType: "9", // WebVault
      deviceIdentifier: deviceId,
      deviceName: "NadSafe Web",
    },
    { form: true, noAuth: true },
  );
}

/** Register a new account. */
export async function register(
  client: ApiClient,
  req: RegisterRequest,
): Promise<void> {
  return client.post<void>("/api/accounts/register", req, { noAuth: true });
}

/** Refresh access token. */
export async function refreshToken(
  client: ApiClient,
  refreshToken: string,
  deviceId: string,
): Promise<TokenResponse> {
  return client.post<TokenResponse>(
    "/identity/connect/token",
    {
      grant_type: "refresh_token",
      client_id: "web",
      refresh_token: refreshToken,
      deviceIdentifier: deviceId,
    },
    { form: true, noAuth: true },
  );
}

/** Persist a device ID in localStorage (stable per browser/device). */
export function getOrCreateDeviceId(): string {
  const key = "nadsafe_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}
