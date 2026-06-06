import { useCallback } from "react";
import { getApiClient } from "../lib/api/client";
import { createFolder, renameFolder, deleteFolder } from "../lib/api/folders";
import { encryptField, decryptField } from "../lib/crypto/key-hierarchy";
import { getSessionUserKey } from "../stores/session";
import { useVaultStore, type Folder } from "../stores/vault";

/**
 * Folder management hooks — all operations encrypt/decrypt with session user key.
 */

export function useFolderActions() {
  const { folders, setFolders } = useVaultStore();

  const doCreate = useCallback(async (name: string): Promise<Folder | null> => {
    const userKey = getSessionUserKey();
    if (!userKey) throw new Error("Vault locked");
    const encName = await encryptField(name, userKey);
    const res = await createFolder(getApiClient(), { name: encName });
    const newFolder: Folder = { id: res.id, name };
    setFolders([...folders, newFolder]);
    return newFolder;
  }, [folders, setFolders]);

  const doRename = useCallback(async (folderId: string, name: string): Promise<void> => {
    const userKey = getSessionUserKey();
    if (!userKey) throw new Error("Vault locked");
    const encName = await encryptField(name, userKey);
    await renameFolder(getApiClient(), folderId, { name: encName });
    setFolders(folders.map((f) => f.id === folderId ? { ...f, name } : f));
  }, [folders, setFolders]);

  const doDelete = useCallback(async (folderId: string): Promise<void> => {
    await deleteFolder(getApiClient(), folderId);
    setFolders(folders.filter((f) => f.id !== folderId));
  }, [folders, setFolders]);

  /** Decrypt folder names from sync response (EncStrings → plain text). */
  const decryptFolders = useCallback(async (
    rawFolders: Array<{ id: string; name: string }>,
  ): Promise<Folder[]> => {
    const userKey = getSessionUserKey();
    if (!userKey) return rawFolders.map((f) => ({ id: f.id, name: f.name }));
    return Promise.all(
      rawFolders.map(async (f) => {
        try {
          const name = await decryptField(f.name, userKey);
          return { id: f.id, name: name ?? f.name };
        } catch {
          return { id: f.id, name: f.name };
        }
      }),
    );
  }, []);

  return { doCreate, doRename, doDelete, decryptFolders };
}
