/**
 * Multi-format vault importer.
 * Converts LastPass CSV, 1Password CSV, KeePass XML → internal Bitwarden JSON format
 * that can then be fed to importBitwardenJson().
 */

export type ImportFormat = "bitwarden" | "lastpass" | "1password" | "keepass" | "csv";

export interface RawVaultItem {
  type: 1 | 2 | 3 | 4; // 1=login, 2=note, 3=card, 4=identity
  name: string;
  notes?: string | null;
  favorite?: boolean;
  login?: {
    username?: string | null;
    password?: string | null;
    totp?: string | null;
    uris?: Array<{ uri: string; match?: null }>;
  };
  secureNote?: { type: 0 };
  card?: {
    cardholderName?: string | null;
    brand?: string | null;
    number?: string | null;
    expMonth?: string | null;
    expYear?: string | null;
    code?: string | null;
  };
}

/** Detect the format of the import file. */
export function detectFormat(content: string, filename: string): ImportFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xml")) return "keepass";
  if (lower.endsWith(".json")) {
    try {
      const parsed = JSON.parse(content);
      // Bitwarden export has "encrypted" field and "items" array
      if ("items" in parsed || "ciphers" in parsed || "encrypted" in parsed) return "bitwarden";
      // 1Password has "accounts" or "items" at root with different shape
      if (parsed.items?.[0]?.trashed !== undefined) return "1password";
    } catch { /* */ }
    return "bitwarden";
  }
  if (lower.endsWith(".csv")) {
    // LastPass CSV has "url,username,password,totp,extra,name,grouping,fav" header
    const firstLine = content.split("\n")[0]?.toLowerCase() ?? "";
    if (firstLine.includes("grouping") || firstLine.includes("extra")) return "lastpass";
    if (firstLine.includes("uuid") || firstLine.includes("totp_secret")) return "1password";
    return "csv";
  }
  return "bitwarden";
}

// ─── LastPass CSV ──────────────────────────────────────────────────────────────
// Format: url,username,password,totp,extra,name,grouping,fav

export function parseLastPassCsv(csv: string): RawVaultItem[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]).map((h) => h.toLowerCase().trim());

  return lines.slice(1).flatMap((line) => {
    if (!line.trim()) return [];
    const cols = parseCsvRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ""; });

    const isNote = row.url === "http://sn" || !row.url;
    if (isNote) {
      return [{
        type: 2,
        name: row.name || "Untitled note",
        notes: row.extra || null,
        secureNote: { type: 0 },
      }] as RawVaultItem[];
    }

    return [{
      type: 1,
      name: row.name || row.url || "Untitled",
      favorite: row.fav === "1",
      login: {
        username: row.username || null,
        password: row.password || null,
        totp: row.totp || null,
        uris: row.url ? [{ uri: row.url, match: null }] : [],
      },
      notes: row.extra || null,
    }] as RawVaultItem[];
  });
}

// ─── 1Password CSV ─────────────────────────────────────────────────────────────
// Format: Title, Username, Password, OTPAuth, URLs, ..., Notes

export function parse1PasswordCsv(csv: string): RawVaultItem[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]).map((h) => h.toLowerCase().trim());

  return lines.slice(1).flatMap((line) => {
    if (!line.trim()) return [];
    const cols = parseCsvRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ""; });

    const url = row["website"] || row["url"] || row["urls"] || "";
    return [{
      type: 1,
      name: row["title"] || row["name"] || "Untitled",
      login: {
        username: row["username"] || null,
        password: row["password"] || null,
        totp: row["otpauth"] || row["one-time password"] || null,
        uris: url ? [{ uri: url, match: null }] : [],
      },
      notes: row["notes"] || row["memo"] || null,
    }] as RawVaultItem[];
  });
}

// ─── Generic CSV (NadSafe export format) ─────────────────────────────────────
// Format: name,username,password,totp,url,notes

export function parseGenericCsv(csv: string): RawVaultItem[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]).map((h) => h.toLowerCase().trim());

  return lines.slice(1).flatMap((line) => {
    if (!line.trim()) return [];
    const cols = parseCsvRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ""; });

    return [{
      type: 1,
      name: row["name"] || "Untitled",
      login: {
        username: row["username"] || row["email"] || null,
        password: row["password"] || null,
        totp: row["totp"] || null,
        uris: row["url"] ? [{ uri: row["url"], match: null }] : [],
      },
      notes: row["notes"] || null,
    }] as RawVaultItem[];
  });
}

// ─── KeePass XML ──────────────────────────────────────────────────────────────
// KeePass 2.x XML export format

export function parseKeePassXml(xml: string): RawVaultItem[] {
  const items: RawVaultItem[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  const entries = doc.querySelectorAll("Entry");
  entries.forEach((entry) => {
    const fields: Record<string, string> = {};
    entry.querySelectorAll("String").forEach((str) => {
      const key = str.querySelector("Key")?.textContent?.trim() ?? "";
      const value = str.querySelector("Value")?.textContent?.trim() ?? "";
      if (key) fields[key] = value;
    });

    // Skip groups/folder entries that have no title
    if (!fields["Title"] && !fields["UserName"]) return;

    const url = fields["URL"] ?? "";
    const totp = extractKeePassTotp(entry);

    items.push({
      type: 1,
      name: fields["Title"] || url || "Untitled",
      login: {
        username: fields["UserName"] || null,
        password: fields["Password"] || null,
        totp: totp || null,
        uris: url ? [{ uri: url, match: null }] : [],
      },
      notes: fields["Notes"] || null,
    });
  });

  return items;
}

function extractKeePassTotp(entry: Element): string | null {
  // KeePass TOTP stored in plugin strings
  const totpField = Array.from(entry.querySelectorAll("String")).find((s) => {
    const key = s.querySelector("Key")?.textContent?.toLowerCase() ?? "";
    return key.includes("totp") || key.includes("otp");
  });
  if (totpField) return totpField.querySelector("Value")?.textContent?.trim() ?? null;
  return null;
}

// ─── CSV parser (handles quoted fields) ──────────────────────────────────────

export function parseCsvRow(row: string): string[] {
  const result: string[] = [];
  let inQuotes = false;
  let field = "";

  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  result.push(field);
  return result;
}

/** Parse any supported format into a unified RawVaultItem[]. */
export function parseImportFile(content: string, filename: string): {
  items: RawVaultItem[];
  format: ImportFormat;
} {
  const format = detectFormat(content, filename);
  let items: RawVaultItem[];

  switch (format) {
    case "lastpass":
      items = parseLastPassCsv(content);
      break;
    case "1password":
      items = parse1PasswordCsv(content);
      break;
    case "keepass":
      items = parseKeePassXml(content);
      break;
    case "csv":
      items = parseGenericCsv(content);
      break;
    default:
      // bitwarden — handled by importBitwardenJson separately
      items = [];
  }

  return { items, format };
}
