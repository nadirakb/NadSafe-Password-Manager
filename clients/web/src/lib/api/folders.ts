/**
 * Folder CRUD API — Bitwarden-compatible endpoints.
 */

import type { ApiClient } from "./client";

export interface FolderResponse {
  id: string;
  name: string; // encrypted
  revisionDate: string;
}

export interface CreateFolderRequest {
  name: string; // encrypted
}

export async function listFolders(client: ApiClient): Promise<FolderResponse[]> {
  const res = await client.get<{ data: FolderResponse[] }>("/api/folders");
  return res.data ?? [];
}

export async function createFolder(
  client: ApiClient,
  req: CreateFolderRequest,
): Promise<FolderResponse> {
  return client.post<FolderResponse>("/api/folders", req);
}

export async function renameFolder(
  client: ApiClient,
  folderId: string,
  req: CreateFolderRequest,
): Promise<FolderResponse> {
  return client.put<FolderResponse>(`/api/folders/${folderId}`, req);
}

export async function deleteFolder(
  client: ApiClient,
  folderId: string,
): Promise<void> {
  return client.delete<void>(`/api/folders/${folderId}`);
}
