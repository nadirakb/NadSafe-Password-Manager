/** Bitwarden-compatible API response types. */

export interface PreloginResponse {
  kdf: number;       // 0 = PBKDF2, 1 = Argon2id
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
  Key: string;               // encrypted user key (EncString)
  PrivateKey: string;        // encrypted private RSA key
  Kdf: number;
  KdfIterations: number;
  KdfMemory?: number;
  KdfParallelism?: number;
  ResetMasterPassword: boolean;
  ForcePasswordReset: boolean;
}

export interface RegisterRequest {
  email: string;
  name: string;
  masterPasswordHash: string;  // base64
  masterPasswordHint?: string;
  key: string;                 // encrypted user key (EncString)
  kdf: number;
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
  keys: {
    publicKey: string;         // RSA public key (base64)
    encryptedPrivateKey: string; // EncString
  };
}

export interface SyncResponse {
  Object: "sync";
  Profile: ProfileResponse;
  Folders: FolderResponse[];
  Collections: CollectionResponse[];
  Ciphers: CipherResponse[];
  Domains: null;
  Sends: SendResponse[];
  Policies: PolicyResponse[];
}

export interface ProfileResponse {
  Id: string;
  Name: string;
  Email: string;
  EmailVerified: boolean;
  Premium: boolean;
  MasterPasswordHint: string | null;
  Culture: string;
  TwoFactorEnabled: boolean;
  Key: string;
  PrivateKey: string;
  SecurityStamp: string;
  Organizations: OrganizationResponse[];
}

export interface OrganizationResponse {
  Id: string;
  Name: string;
  Key: string;
  Type: number; // 0=Owner, 1=Admin, 2=User, 3=Manager
  Enabled: boolean;
}

export interface FolderResponse {
  Id: string;
  Name: string; // EncString
  RevisionDate: string;
  Object: "folder";
}

export interface CollectionResponse {
  Id: string;
  OrganizationId: string;
  Name: string; // EncString
  ReadOnly: boolean;
  HidePasswords: boolean;
  Manage: boolean;
  Object: "collection";
}

export interface CipherResponse {
  Id: string;
  OrganizationId: string | null;
  FolderId: string | null;
  CollectionIds: string[];
  Type: number; // 1=Login, 2=Note, 3=Card, 4=Identity
  Name: string; // EncString
  Notes: string | null; // EncString
  Favorite: boolean;
  RevisionDate: string;
  CreationDate: string;
  DeletedDate: string | null;
  Reprompt: number;
  Fields: CipherFieldResponse[] | null;
  Attachments: AttachmentResponse[] | null;
  Login?: LoginDataResponse;
  SecureNote?: SecureNoteDataResponse;
  Card?: CardDataResponse;
  Identity?: IdentityDataResponse;
  Object: "cipher";
}

export interface LoginDataResponse {
  Username: string | null;    // EncString
  Password: string | null;    // EncString
  Totp: string | null;        // EncString
  Uris: UriResponse[] | null;
}

export interface UriResponse {
  Uri: string;  // EncString
  Match: number | null;
}

export interface SecureNoteDataResponse {
  Type: number;
}

export interface CardDataResponse {
  CardholderName: string | null;
  Brand: string | null;
  Number: string | null;
  ExpMonth: string | null;
  ExpYear: string | null;
  Code: string | null;
}

export interface IdentityDataResponse {
  Title: string | null;
  FirstName: string | null;
  LastName: string | null;
  Email: string | null;
  Phone: string | null;
  Company: string | null;
}

export interface CipherFieldResponse {
  Type: number;
  Name: string | null;
  Value: string | null;
}

export interface AttachmentResponse {
  Id: string;
  Url: string;
  FileName: string;
  Size: string;
  SizeName: string;
}

export interface SendResponse {
  Id: string;
}

export interface PolicyResponse {
  Id: string;
  OrganizationId: string;
  Type: number;
  Data: Record<string, unknown> | null;
  Enabled: boolean;
}

export interface ApiError {
  message: string;
  validationErrors?: Record<string, string[]>;
}
