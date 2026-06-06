import { useState, useRef, type ChangeEvent } from "react";
import { getApiClient } from "../lib/api/client";
import { getSessionUserKey } from "../stores/session";
import { importBitwardenJson, type ImportResult } from "../lib/import";
import { parseImportFile, type ImportFormat } from "../lib/importers";
import { createCipher } from "../lib/api/vault";
import { encryptField } from "../lib/crypto/key-hierarchy";
import styles from "./Import.module.css";

const FORMAT_LABELS: Record<ImportFormat, string> = {
  bitwarden: "Bitwarden / NadSafe JSON",
  lastpass: "LastPass CSV",
  "1password": "1Password CSV",
  keepass: "KeePass XML",
  csv: "Generic CSV",
};

const FORMAT_ACCEPT = ".json,.csv,.xml";

export function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<ImportFormat | null>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const userKey = getSessionUserKey();
    if (!userKey) { setError("Vault locked — unlock before importing"); return; }

    setLoading(true);
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: 0 });

    try {
      const text = await file.text();
      const { format, items } = parseImportFile(text, file.name);
      setDetectedFormat(format);

      if (format === "bitwarden") {
        // Use the dedicated Bitwarden importer (handles folders etc.)
        const res = await importBitwardenJson(
          text,
          getApiClient(),
          userKey,
          (done, total) => setProgress({ done, total }),
        );
        setResult(res);
      } else {
        // Generic import: encrypt each field and create via API
        const client = getApiClient();
        let imported = 0;
        let failed = 0;
        const errors: string[] = [];

        for (let i = 0; i < items.length; i++) {
          setProgress({ done: i, total: items.length });
          const raw = items[i];
          try {
            const encName = await encryptField(raw.name || "Untitled", userKey);
            const encNotes = raw.notes ? await encryptField(raw.notes, userKey) : null;

            const cipher: Parameters<typeof createCipher>[1] = {
              type: raw.type,
              name: encName,
              notes: encNotes,
              folderId: null,
              organizationId: null,
              collectionIds: [],
              favorite: raw.favorite ?? false,
              reprompt: 0,
              fields: [],
            };

            if (raw.type === 1 && raw.login) {
              const [encUser, encPass, encTotp] = await Promise.all([
                raw.login.username ? encryptField(raw.login.username, userKey) : Promise.resolve(null),
                raw.login.password ? encryptField(raw.login.password, userKey) : Promise.resolve(null),
                raw.login.totp ? encryptField(raw.login.totp, userKey) : Promise.resolve(null),
              ]);
              const encUris = await Promise.all(
                (raw.login.uris ?? []).map(async (u) => ({
                  uri: await encryptField(u.uri, userKey),
                  match: null as number | null,
                })),
              );
              cipher.login = { username: encUser, password: encPass, totp: encTotp, uris: encUris };
            }

            if (raw.type === 2) {
              cipher.secureNote = { type: 0 };
            }

            if (raw.type === 3 && raw.card) {
              const [cName, brand, number, expM, expY, code] = await Promise.all([
                raw.card.cardholderName ? encryptField(raw.card.cardholderName, userKey) : Promise.resolve(null),
                raw.card.brand ? encryptField(raw.card.brand, userKey) : Promise.resolve(null),
                raw.card.number ? encryptField(raw.card.number, userKey) : Promise.resolve(null),
                raw.card.expMonth ? encryptField(raw.card.expMonth, userKey) : Promise.resolve(null),
                raw.card.expYear ? encryptField(raw.card.expYear, userKey) : Promise.resolve(null),
                raw.card.code ? encryptField(raw.card.code, userKey) : Promise.resolve(null),
              ]);
              cipher.card = { cardholderName: cName, brand, number, expMonth: expM, expYear: expY, code };
            }

            await createCipher(client, cipher);
            imported++;
          } catch (err) {
            failed++;
            errors.push(`"${raw.name}": ${err instanceof Error ? err.message : "failed"}`);
          }
        }

        setResult({ imported, failed, errors });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Import</h1>
      </header>

      <div className={styles.content}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Import vault</h2>
          <p className={styles.cardDesc}>
            Import passwords from other password managers. All data is encrypted on this device
            before being stored on the server.
          </p>

          <div className={styles.dropZone} onClick={() => fileRef.current?.click()}>
            <span className={styles.dropIcon}>{loading ? "⏳" : "📥"}</span>
            <span className={styles.dropLabel}>
              {loading
                ? progress
                  ? `Importing ${progress.done} / ${progress.total}…`
                  : "Reading file…"
                : detectedFormat
                ? `${FORMAT_LABELS[detectedFormat]} detected — click to re-import`
                : "Click to choose file (.json, .csv, .xml)"}
            </span>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept={FORMAT_ACCEPT}
            onChange={handleFile}
            style={{ display: "none" }}
            disabled={loading}
          />

          {error && <p className={styles.error}>{error}</p>}

          {result && (
            <div className={[styles.resultBox, result.failed > 0 ? styles.resultWarn : styles.resultOk].join(" ")}>
              <p>
                {detectedFormat && <strong>{FORMAT_LABELS[detectedFormat]} · </strong>}
                <strong>{result.imported}</strong> items imported
                {result.failed > 0 && <>, <strong>{result.failed}</strong> failed</>}
              </p>
              {result.errors.length > 0 && (
                <ul className={styles.errorList}>
                  {result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                  {result.errors.length > 5 && <li>…and {result.errors.length - 5} more</li>}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Supported formats</h2>
          <ul className={styles.formatList}>
            <li>✓ Bitwarden JSON (unencrypted export)</li>
            <li>✓ NadSafe JSON (same format)</li>
            <li>✓ LastPass CSV (file → Export → CSV)</li>
            <li>✓ 1Password CSV (file → Export → CSV)</li>
            <li>✓ KeePass XML (File → Export → KeePass XML 2.x)</li>
            <li>✓ Generic CSV (name, username, password, totp, url, notes)</li>
          </ul>
          <p className={styles.cardDesc} style={{ marginTop: "var(--space-4)" }}>
            All data is encrypted client-side before leaving this device. The server never sees plaintext.
          </p>
        </div>
      </div>
    </div>
  );
}
