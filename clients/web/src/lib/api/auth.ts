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

/** Thrown when server requires a 2FA token before completing login. */
export class TwoFactorRequiredError extends Error {
  /** Bitmask of available providers: 0=TOTP, 3=Duo, 4=YubiKey, 7=WebAuthn */
  providers: number[];
  constructor(providers: number[]) {
    super("Two-factor authentication required");
    this.name = "TwoFactorRequiredError";
    this.providers = providers;
  }
}

/** Step 2: exchange auth hash for tokens. Throws TwoFactorRequiredError when 2FA is needed. */
export async function loginWithPassword(
  client: ApiClient,
  email: string,
  authHashBytes: Uint8Array,
  deviceId: string,
  twoFactorToken?: string,
  twoFactorProvider = 0, // 0 = TOTP authenticator app
): Promise<TokenResponse> {
  const passwordHash = toB64(authHashBytes);

  const body: Record<string, string> = {
    grant_type: "password",
    username: email,
    password: passwordHash,
    scope: "api offline_access",
    client_id: "web",
    deviceType: "9", // WebVault
    deviceIdentifier: deviceId,
    deviceName: "NadSafe Web",
  };

  if (twoFactorToken) {
    body.twoFactorToken = twoFactorToken;
    body.twoFactorProvider = String(twoFactorProvider);
    body.twoFactorRemember = "0";
  }

  try {
    return await client.post<TokenResponse>(
      "/identity/connect/token",
      body,
      { form: true, noAuth: true },
    );
  } catch (err) {
    // Vaultwarden returns 400 with TwoFactorProviders when 2FA is required
    if (err instanceof Error && err.message.includes("Two factor required")) {
      throw new TwoFactorRequiredError([0]); // default to TOTP
    }
    // Parse provider list from error response if available
    const raw = (err as { providers?: number[] }).providers;
    if (Array.isArray(raw)) throw new TwoFactorRequiredError(raw);
    throw err;
  }
}

/** Register a new account.
 *
 * Vaultwarden 1.32+ uses /identity/accounts/register.
 * kdfMemory is in MB (not KiB) per the Vaultwarden 1.36 API.
 */
export async function register(
  client: ApiClient,
  req: RegisterRequest,
): Promise<void> {
  return client.post<void>("/identity/accounts/register", req, { noAuth: true });
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
