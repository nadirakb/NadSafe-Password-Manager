/**
 * Import from Bitwarden JSON export format (personal vault).
 * Encrypts each field with the user's session key and creates items via API.
 */

import type { ApiClient } from "./api/client";
import { createCipher, type CreateCipherRequest } from "./api/vault";
import { encryptField } from "./crypto/key-hierarchy";
import type { SymKey } from "./crypto/types";

interface BitwardenExportItem {
  type: number;
  name: string;
  notes?: string | null;
  favorite?: boolean;
  login?: {
    username?: string | null;
    password?: string | null;
    totp?: string | null;
    uris?: Array<{ uri: string; match?: number | null }>;
  };
  secureNote?: { type: number };
  card?: {
    cardholderName?: string | null;
    brand?: string | null;
    number?: string | null;
    expMonth?: string | null;
    expYear?: string | null;
    code?: string | null;
  };
}

interface BitwardenExport {
  encrypted: boolean;
  items: BitwardenExportItem[];
}

export interface ImportResult {
  imported: number;
  failed: number;
  errors: string[];
}

export async function importBitwardenJson(
  json: string,
  client: ApiClient,
  userKey: SymKey,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  let data: BitwardenExport;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON file");
  }

  if (data.encrypted) {
    throw new Error("Encrypted Bitwarden exports are not supported — export as unencrypted JSON");
  }

  const items = data.items ?? [];
  const result: ImportResult = { imported: 0, failed: 0, errors: [] };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.(i, items.length);

    try {
      const payload = await encryptItem(item, userKey);
      await createCipher(client, payload);
      result.imported++;
    } catch (err) {
      result.failed++;
      result.errors.push(`"${item.name}": ${err instanceof Error ? err.message : "unknown error"}`);
    }

    // Small delay to avoid hammering the server
    if (i % 10 === 9) await new Promise((r) => setTimeout(r, 100));
  }

  onProgress?.(items.length, items.length);
  return result;
}

async function encryptItem(
  item: BitwardenExportItem,
  key: SymKey,
): Promise<CreateCipherRequest> {
  const enc = (v: string | null | undefined) =>
    v != null ? encryptField(v, key) : Promise.resolve(null);

  const [encName, encNotes] = await Promise.all([
    encryptField(item.name || "(unnamed)", key),
    enc(item.notes),
  ]);

  const base: CreateCipherRequest = {
    type: item.type,
    name: encName,
    notes: encNotes,
    folderId: null,
    organizationId: null,
    collectionIds: [],
    favorite: item.favorite ?? false,
    reprompt: 0,
    fields: [],
  };

  if (item.type === 1 && item.login) {
    const [username, password, totp, ...uriEncs] = await Promise.all([
      enc(item.login.username),
      enc(item.login.password),
      enc(item.login.totp),
      ...(item.login.uris ?? []).map((u) => enc(u.uri)),
    ]);
    base.login = {
      username,
      password,
      totp,
      uris: (item.login.uris ?? []).map((u, idx) => ({
        uri: uriEncs[idx] ?? "",
        match: u.match ?? null,
      })),
    };
  }

  if (item.type === 2) {
    base.secureNote = { type: 0 };
  }

  if (item.type === 3 && item.card) {
    const [cardholderName, brand, number, expMonth, expYear, code] = await Promise.all([
      enc(item.card.cardholderName),
      enc(item.card.brand),
      enc(item.card.number),
      enc(item.card.expMonth),
      enc(item.card.expYear),
      enc(item.card.code),
    ]);
    base.card = { cardholderName, brand, number, expMonth, expYear, code };
  }

  return base;
}
