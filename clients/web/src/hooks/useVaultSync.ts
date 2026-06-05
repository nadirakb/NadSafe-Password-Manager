import { useCallback, useState } from "react";
import { getApiClient } from "../lib/api/client";
import { sync } from "../lib/api/vault";
import { getSessionUserKey } from "../stores/session";
import { useVaultStore, type VaultItem } from "../stores/vault";
import { decryptField } from "../lib/crypto/key-hierarchy";
import type { CipherResponse } from "../lib/api/types";
import type { SymKey } from "../lib/crypto/types";

const CIPHER_TYPE: Record<number, VaultItem["type"]> = {
  1: "login",
  2: "note",
  3: "card",
  4: "identity",
};

async function decryptCipher(
  cipher: CipherResponse,
  userKey: SymKey,
): Promise<VaultItem> {
  const name = (await decryptField(cipher.Name, userKey)) ?? "(unnamed)";

  const item: VaultItem = {
    id: cipher.Id,
    type: CIPHER_TYPE[cipher.Type] ?? "login",
    name,
    folderId: cipher.FolderId,
    collectionIds: cipher.CollectionIds,
    favorite: cipher.Favorite,
    createdAt: cipher.CreationDate,
    updatedAt: cipher.RevisionDate,
  };

  if (cipher.Type === 1 && cipher.Login) {
    const [username, password, totp] = await Promise.all([
      decryptField(cipher.Login.Username, userKey),
      decryptField(cipher.Login.Password, userKey),
      decryptField(cipher.Login.Totp, userKey),
    ]);
    const uris = await Promise.all(
      (cipher.Login.Uris ?? []).map((u) => decryptField(u.Uri, userKey)),
    );
    item.login = {
      username: username ?? "",
      password: password ?? "",
      uris: uris.filter(Boolean) as string[],
      totp,
    };
  }

  if (cipher.Type === 2) {
    const content = await decryptField(cipher.Notes, userKey);
    item.note = { content: content ?? "" };
  }

  return item;
}

export function useVaultSync() {
  const { setItems, setFolders, setCollections, setSyncing, markSynced } = useVaultStore();
  const [error, setError] = useState<string | null>(null);

  const doSync = useCallback(async () => {
    const userKey = getSessionUserKey();
    if (!userKey) {
      setError("Vault locked — cannot sync");
      return;
    }

    setSyncing(true);
    setError(null);

    try {
      const client = getApiClient();
      const data = await sync(client);

      // Decrypt all ciphers in parallel (batched to avoid too many concurrent WebCrypto ops)
      const BATCH = 20;
      const decrypted: VaultItem[] = [];
      for (let i = 0; i < data.Ciphers.length; i += BATCH) {
        const batch = data.Ciphers.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map((c) => decryptCipher(c, userKey).catch(() => null)),
        );
        for (const r of results) if (r) decrypted.push(r);
      }

      // Decrypt folders
      const folders = await Promise.all(
        data.Folders.map(async (f) => ({
          id: f.Id,
          name: (await decryptField(f.Name, userKey)) ?? "(folder)",
        })),
      );

      // Decrypt collections
      const collections = await Promise.all(
        data.Collections.map(async (c) => ({
          id: c.Id,
          organizationId: c.OrganizationId,
          name: (await decryptField(c.Name, userKey)) ?? "(collection)",
          readOnly: c.ReadOnly,
          hidePasswords: c.HidePasswords,
          manage: c.Manage,
        })),
      );

      setItems(decrypted);
      setFolders(folders);
      setCollections(collections);
      markSynced();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [setItems, setFolders, setCollections, setSyncing, markSynced]);

  return { doSync, error };
}
