import { useState, useRef, type ChangeEvent } from "react";
import { getApiClient } from "../lib/api/client";
import { getSessionUserKey } from "../stores/session";
import { importBitwardenJson, type ImportResult } from "../lib/import";
import styles from "./Import.module.css";

export function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const res = await importBitwardenJson(
        text,
        getApiClient(),
        userKey,
        (done, total) => setProgress({ done, total }),
      );
      setResult(res);
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
          <h2 className={styles.cardTitle}>Bitwarden / NadSafe JSON</h2>
          <p className={styles.cardDesc}>
            Export your vault from Bitwarden as an unencrypted JSON file, then import here.
            All items are re-encrypted with your NadSafe master password on this device.
          </p>

          <div className={styles.dropZone} onClick={() => fileRef.current?.click()}>
            <span className={styles.dropIcon}>{loading ? "⏳" : "📥"}</span>
            <span className={styles.dropLabel}>
              {loading
                ? progress
                  ? `Importing ${progress.done} / ${progress.total}…`
                  : "Importing…"
                : "Click to choose a .json file"}
            </span>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".json"
            onChange={handleFile}
            style={{ display: "none" }}
            disabled={loading}
          />

          {error && <p className={styles.error}>{error}</p>}

          {result && (
            <div className={[styles.resultBox, result.failed > 0 ? styles.resultWarn : styles.resultOk].join(" ")}>
              <p>
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
            <li>○ KeePass KDBX — coming soon</li>
            <li>○ LastPass CSV — coming soon</li>
            <li>○ 1Password 1PUX — coming soon</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
