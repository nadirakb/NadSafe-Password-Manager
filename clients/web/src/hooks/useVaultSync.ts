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

export async function decryptCipher(
  cipher: CipherResponse,
  userKey: SymKey,
): Promise<VaultItem> {
  // Vaultwarden 1.36: all keys are lowercase
  const name = (await decryptField(cipher.name, userKey)) ?? "(unnamed)";

  const item: VaultItem = {
    id: cipher.id,
    type: CIPHER_TYPE[cipher.type] ?? "login",
    name,
    folderId: cipher.folderId,
    organizationId: cipher.organizationId,
    collectionIds: cipher.collectionIds,
    favorite: cipher.favorite,
    createdAt: cipher.creationDate,
    updatedAt: cipher.revisionDate,
  };

  // Notes exist on every cipher type, not just secure notes — dropping them
  // here would silently lose data on the next edit round-trip.
  if (cipher.notes) {
    const content = await decryptField(cipher.notes, userKey);
    if (content) item.note = { content };
  }

  if (cipher.type === 1 && cipher.login) {
    const [username, password, totp] = await Promise.all([
      decryptField(cipher.login.username, userKey),
      decryptField(cipher.login.password, userKey),
      decryptField(cipher.login.totp, userKey),
    ]);
    const uris = await Promise.all(
      (cipher.login.uris ?? []).map((u) => decryptField(u.uri, userKey)),
    );
    item.login = {
      username: username ?? "",
      password: password ?? "",
      uris: uris.filter(Boolean) as string[],
      totp,
    };
  }

  if (cipher.type === 2 && !item.note) {
    item.note = { content: "" };
  }

  if (cipher.type === 3 && cipher.card) {
    const [cardholderName, brand, number, expMonth, expYear, code] = await Promise.all([
      decryptField(cipher.card.cardholderName, userKey),
      decryptField(cipher.card.brand, userKey),
      decryptField(cipher.card.number, userKey),
      decryptField(cipher.card.expMonth, userKey),
      decryptField(cipher.card.expYear, userKey),
      decryptField(cipher.card.code, userKey),
    ]);
    item.card = {
      cardholderName: cardholderName ?? "",
      brand: brand ?? "",
      number: number ?? "",
      expMonth: expMonth ?? "",
      expYear: expYear ?? "",
      code: code ?? "",
    };
  }

  // Identity (type 4): notes already carried above (full identity fields = §future)

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

      // Vaultwarden 1.36 returns lowercase keys.
      // Soft-deleted ciphers (trash) come back in /sync too — keep them out of the vault list.
      const ciphers = (data.ciphers ?? []).filter((c) => !c.deletedDate);
      const BATCH = 20;
      const decrypted: VaultItem[] = [];
      for (let i = 0; i < ciphers.length; i += BATCH) {
        const batch = ciphers.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map((c) => decryptCipher(c, userKey).catch(() => null)),
        );
        for (const r of results) if (r) decrypted.push(r);
      }

      const folders = await Promise.all(
        (data.folders ?? []).map(async (f) => ({
          id: f.id,
          name: (await decryptField(f.name, userKey)) ?? "(folder)",
        })),
      );

      const collections = await Promise.all(
        (data.collections ?? []).map(async (c) => ({
          id: c.id,
          organizationId: c.organizationId,
          name: (await decryptField(c.name, userKey)) ?? "(collection)",
          readOnly: c.readOnly,
          hidePasswords: c.hidePasswords,
          manage: c.manage,
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
