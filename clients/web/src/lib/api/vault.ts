import type { ApiClient } from "./client";
import type { CipherResponse, FolderResponse, SyncResponse } from "./types";

export async function sync(client: ApiClient): Promise<SyncResponse> {
  return client.get<SyncResponse>("/api/sync?excludeDomains=true");
}

export async function getCipher(
  client: ApiClient,
  id: string,
): Promise<CipherResponse> {
  return client.get<CipherResponse>(`/api/ciphers/${id}`);
}

export interface CreateCipherRequest {
  type: number;
  name: string; // EncString
  notes: string | null;
  folderId: string | null;
  organizationId: string | null;
  collectionIds: string[];
  favorite: boolean;
  reprompt: number;
  fields: unknown[];
  login?: {
    username: string | null;
    password: string | null;
    totp: string | null;
    uris: Array<{ uri: string; match: number | null }>;
  };
  secureNote?: { type: number };
  card?: {
    cardholderName: string | null;
    brand: string | null;
    number: string | null;
    expMonth: string | null;
    expYear: string | null;
    code: string | null;
  };
}

export async function createCipher(
  client: ApiClient,
  cipher: CreateCipherRequest,
): Promise<CipherResponse> {
  return client.post<CipherResponse>("/api/ciphers", cipher);
}

export async function updateCipher(
  client: ApiClient,
  id: string,
  cipher: CreateCipherRequest,
): Promise<CipherResponse> {
  return client.put<CipherResponse>(`/api/ciphers/${id}`, cipher);
}

export async function deleteCipher(
  client: ApiClient,
  id: string,
): Promise<void> {
  return client.delete<void>(`/api/ciphers/${id}`);
}

export async function createFolder(
  client: ApiClient,
  name: string, // EncString
): Promise<FolderResponse> {
  return client.post<FolderResponse>("/api/folders", { name });
}

export async function deleteFolder(
  client: ApiClient,
  id: string,
): Promise<void> {
  return client.delete<void>(`/api/folders/${id}`);
}
