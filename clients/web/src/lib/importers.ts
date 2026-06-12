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
      // 1Password JSON (items carry a "trashed" flag) must be checked before
      // the Bitwarden test — both shapes have an "items" array.
      if (parsed.items?.[0]?.trashed !== undefined || "accounts" in parsed) return "1password";
      // Bitwarden export has "encrypted" field and "items" array
      if ("items" in parsed || "ciphers" in parsed || "encrypted" in parsed) return "bitwarden";
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
  return csvRecords(csv).flatMap((row) => {
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
  return csvRecords(csv).flatMap((row) => {
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

// Inverse of the export-side formula-injection guard (see export.ts
// csvEscape): the exporter prepends one quote to any cell matching
// `'*<formula char>`, so stripping exactly one such quote restores the
// original value. Applied only to NadSafe's own CSV format — foreign exports
// (LastPass, 1Password) may contain legitimate leading apostrophes.
function unescapeFormulaGuard(val: string): string {
  return /^''*[=+\-@\t\r]/.test(val) ? val.slice(1) : val;
}

export function parseGenericCsv(csv: string): RawVaultItem[] {
  return csvRecords(csv).flatMap((rawRow) => {
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawRow)) row[k] = unescapeFormulaGuard(v);
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

// ─── CSV parser (handles quoted fields, CRLF, and newlines inside quotes) ────

/**
 * Parse a whole CSV document into rows of fields (RFC 4180).
 * Quote handling must run over the full text — splitting on "\n" first would
 * corrupt quoted fields that contain newlines (e.g. LastPass "extra" notes)
 * and leave a trailing "\r" on every field of a CRLF-exported file.
 */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') {
      if (inQuotes && content[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      pushField();
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && content[i + 1] === "\n") i++;
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) pushRow();

  // Drop fully-empty rows (blank lines between records)
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Backwards-compatible single-row parse (no embedded newlines). */
export function parseCsvRow(row: string): string[] {
  return parseCsv(row)[0] ?? [""];
}

/** Parse a CSV document into header-keyed records (headers lowercased). */
function csvRecords(csv: string): Array<Record<string, string>> {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.toLowerCase().trim());
  return rows.slice(1).map((cols) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ""; });
    return row;
  });
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
      // Only the CSV export is supported — running the CSV parser over a JSON
      // body would import garbage rows instead of failing loudly.
      if (filename.toLowerCase().endsWith(".json")) {
        throw new Error("1Password JSON exports are not supported — export as CSV instead");
      }
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
