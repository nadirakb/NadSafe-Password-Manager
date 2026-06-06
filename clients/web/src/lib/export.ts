/**
 * Vault export — decrypted Bitwarden JSON format.
 * Zero-knowledge: decryption happens client-side only.
 */

import type { VaultItem, Folder } from "../stores/vault";

interface BitwardenExportLogin {
  username: string | null;
  password: string | null;
  totp: string | null;
  uris: Array<{ uri: string; match: number | null }>;
}

interface BitwardenExportItem {
  id: string;
  organizationId: string | null;
  folderId: string | null;
  type: 1 | 2 | 3 | 4; // 1=login, 2=note, 3=card, 4=identity
  name: string;
  notes: string | null;
  favorite: boolean;
  fields: unknown[];
  reprompt: 0;
  login?: BitwardenExportLogin;
  secureNote?: { type: 0 };
  card?: {
    cardholderName: string | null;
    brand: string | null;
    number: string | null;
    expMonth: string | null;
    expYear: string | null;
    code: string | null;
  };
}

interface BitwardenExportFolder {
  id: string;
  name: string;
}

interface BitwardenExport {
  encrypted: false;
  folders: BitwardenExportFolder[];
  items: BitwardenExportItem[];
}

const TYPE_MAP: Record<string, 1 | 2 | 3 | 4> = {
  login: 1,
  note: 2,
  card: 3,
  identity: 4,
};

function itemToExport(item: VaultItem): BitwardenExportItem {
  const base: BitwardenExportItem = {
    id: item.id,
    organizationId: null,
    folderId: item.folderId,
    type: TYPE_MAP[item.type] ?? 1,
    name: item.name,
    notes: item.note?.content ?? null,
    favorite: item.favorite,
    fields: [],
    reprompt: 0,
  };

  if (item.login) {
    base.login = {
      username: item.login.username || null,
      password: item.login.password || null,
      totp: item.login.totp,
      uris: item.login.uris.map((uri) => ({ uri, match: null })),
    };
  }

  if (item.type === "note") {
    base.secureNote = { type: 0 };
  }

  if (item.card) {
    base.card = {
      cardholderName: item.card.cardholderName || null,
      brand: item.card.brand || null,
      number: item.card.number || null,
      expMonth: item.card.expMonth || null,
      expYear: item.card.expYear || null,
      code: item.card.code || null,
    };
  }

  return base;
}

/** Build Bitwarden JSON export from decrypted vault items and folders. */
export function buildExportJson(items: VaultItem[], folders: Folder[]): string {
  const exportData: BitwardenExport = {
    encrypted: false,
    folders: folders.map((f) => ({ id: f.id, name: f.name })),
    items: items.map(itemToExport),
  };
  return JSON.stringify(exportData, null, 2);
}

/** Trigger browser download of the vault JSON export file. */
export function downloadJson(json: string, filename?: string): void {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const fname = filename ?? `nadsafe_export_${dateStr}.json`;

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Export vault as CSV (simplified — login items only). */
export function buildExportCsv(items: VaultItem[]): string {
  const header = "name,username,password,totp,url,notes";
  const rows = items
    .filter((i) => i.type === "login")
    .map((i) => {
      const row = [
        csvEscape(i.name),
        csvEscape(i.login?.username ?? ""),
        csvEscape(i.login?.password ?? ""),
        csvEscape(i.login?.totp ?? ""),
        csvEscape(i.login?.uris[0] ?? ""),
        csvEscape(i.note?.content ?? ""),
      ];
      return row.join(",");
    });
  return [header, ...rows].join("\n");
}

export function downloadCsv(csv: string, filename?: string): void {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const fname = filename ?? `nadsafe_export_${dateStr}.csv`;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
