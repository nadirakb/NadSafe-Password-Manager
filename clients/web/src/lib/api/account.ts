/**
 * Account management API — password change, 2FA TOTP.
 * All endpoints require Bearer auth.
 */

import type { ApiClient } from "./client";

export interface ChangePasswordRequest {
  masterPasswordHash: string;
  newMasterPasswordHash: string;
  key: string; // re-wrapped user key with new stretch
}

export interface TwoFactorAuthenticatorResponse {
  enabled: boolean;
  key?: string; // base32 TOTP secret (only on first setup)
  qrCodeImage?: string; // data:image/png;base64,... (only on first setup)
}

export interface EnableTotpRequest {
  masterPasswordHash: string;
  token: string; // 6-digit TOTP code to confirm
  key: string;   // base32 TOTP secret
}

export interface DisableTotpRequest {
  masterPasswordHash: string;
  type: 0; // 0 = authenticator app
}

export interface ProfileResponse {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  premium: boolean;
  twoFactorEnabled: boolean;
  publicKey: string;
  privateKey: string;
}

/** Change master password. Server re-derives auth hash; we send old+new hash + re-wrapped key. */
export async function changePassword(
  client: ApiClient,
  req: ChangePasswordRequest,
): Promise<void> {
  return client.post<void>("/api/accounts/password", req);
}

/** Get current 2FA authenticator app status + secret for enrollment. */
export async function getTotpSetupKey(
  client: ApiClient,
): Promise<TwoFactorAuthenticatorResponse> {
  return client.get<TwoFactorAuthenticatorResponse>(
    "/api/two-factor/get-authenticator",
  );
}

/** Enable TOTP 2FA — must supply valid TOTP code to confirm. */
export async function enableTotp(
  client: ApiClient,
  req: EnableTotpRequest,
): Promise<TwoFactorAuthenticatorResponse> {
  return client.post<TwoFactorAuthenticatorResponse>(
    "/api/two-factor/authenticator",
    req,
  );
}

/** Disable TOTP 2FA. */
export async function disableTotp(
  client: ApiClient,
  req: DisableTotpRequest,
): Promise<void> {
  return client.post<void>("/api/two-factor/disable", req);
}

/** Fetch full account profile. */
export async function getProfile(client: ApiClient): Promise<ProfileResponse> {
  return client.get<ProfileResponse>("/api/accounts/profile");
}
