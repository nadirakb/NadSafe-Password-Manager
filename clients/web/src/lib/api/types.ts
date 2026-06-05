/** Bitwarden-compatible API response types — Vaultwarden 1.36 (lowercase keys). */

export interface PreloginResponse {
  kdf: number;
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token: string;
  scope: string;
  /** Encrypted user key (EncString). Returned on password login; absent on token refresh. */
  Key?: string;         // Vaultwarden 1.35 and earlier (PascalCase)
  key?: string;         // Vaultwarden 1.36+ (lowercase)
  PrivateKey?: string;  // encrypted RSA private key (PascalCase)
  privateKey?: string;  // Vaultwarden 1.36+ (lowercase)
  kdf?: number;
  kdfIterations?: number;
  kdfMemory?: number;
  kdfParallelism?: number;
}

/** Helper: get the encrypted user key regardless of case. */
export function getTokenKey(t: TokenResponse): string | undefined {
  return t.Key ?? t.key;
}

export interface RegisterRequest {
  email: string;
  name: string;
  masterPasswordHash: string;
  masterPasswordHint?: string;
  key: string;
  kdf: number;
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
  keys: {
    publicKey: string;
    encryptedPrivateKey: string;
  };
}

// ── Sync response — Vaultwarden 1.36 lowercase ─────────────────────────────

export interface SyncResponse {
  object: string;
  profile: ProfileResponse;
  folders: FolderResponse[];
  collections: CollectionResponse[];
  ciphers: CipherResponse[];
  sends: unknown[];
  policies: PolicyResponse[];
  domains: null;
}

export interface ProfileResponse {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  premium: boolean;
  key: string;           // encrypted user key (EncString)
  privateKey: string;    // encrypted private RSA key (EncString)
  organizations: OrganizationResponse[];
}

export interface OrganizationResponse {
  id: string;
  name: string;
  key: string;
  type: number;
  enabled: boolean;
}

export interface FolderResponse {
  id: string;
  name: string;
  revisionDate: string;
  object: string;
}

export interface CollectionResponse {
  id: string;
  organizationId: string;
  name: string;
  readOnly: boolean;
  hidePasswords: boolean;
  manage: boolean;
  object: string;
}

export interface CipherResponse {
  id: string;
  organizationId: string | null;
  folderId: string | null;
  collectionIds: string[];
  type: number;  // 1=Login, 2=SecureNote, 3=Card, 4=Identity
  name: string;  // EncString
  notes: string | null;
  favorite: boolean;
  revisionDate: string;
  creationDate: string;
  deletedDate: string | null;
  reprompt: number;
  fields: CipherFieldResponse[] | null;
  attachments: AttachmentResponse[] | null;
  login?: LoginDataResponse;
  secureNote?: SecureNoteDataResponse;
  card?: CardDataResponse;
  identity?: IdentityDataResponse;
  key: string | null;
  object: string;
}

export interface LoginDataResponse {
  username: string | null;
  password: string | null;
  totp: string | null;
  uris: UriResponse[] | null;
}

export interface UriResponse {
  uri: string;
  match: number | null;
}

export interface SecureNoteDataResponse {
  type: number;
}

export interface CardDataResponse {
  cardholderName: string | null;
  brand: string | null;
  number: string | null;
  expMonth: string | null;
  expYear: string | null;
  code: string | null;
}

export interface IdentityDataResponse {
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
}

export interface CipherFieldResponse {
  type: number;
  name: string | null;
  value: string | null;
}

export interface AttachmentResponse {
  id: string;
  url: string;
  fileName: string;
  size: string;
  sizeName: string;
}

export interface PolicyResponse {
  id: string;
  organizationId: string;
  type: number;
  data: Record<string, unknown> | null;
  enabled: boolean;
}

export interface ApiError {
  message: string;
  validationErrors?: Record<string, string[]>;
}
