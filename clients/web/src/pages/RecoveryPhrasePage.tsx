/**
 * Recovery phrase display (shown once after registration) and
 * recovery entry (account recovery flow).
 */

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./RecoveryPhrase.module.css";

// ── Recovery phrase display ────────────────────────────────────────

interface ShowRecoveryPhraseProps {
  phrase: string; // space-separated 24 words
  onConfirmed: () => void;
}

export function ShowRecoveryPhrase({ phrase, onConfirmed }: ShowRecoveryPhraseProps) {
  const words = phrase.split(" ");
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(phrase).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.iconRow}>
          <span className={styles.icon}>🔑</span>
        </div>
        <h1 className={styles.title}>Save your recovery phrase</h1>
        <p className={styles.desc}>
          This 24-word phrase is the <strong>only</strong> way to recover your vault if you forget your master password.
          Write it down and store it somewhere safe — it will never be shown again.
        </p>

        <div className={styles.wordGrid}>
          {words.map((word, i) => (
            <div key={i} className={styles.wordCell}>
              <span className={styles.wordNum}>{i + 1}</span>
              <span className={styles.word}>{word}</span>
            </div>
          ))}
        </div>

        <button className={styles.copyBtn} onClick={copy}>
          {copied ? "✓ Copied to clipboard" : "Copy all words"}
        </button>

        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>I have written down my recovery phrase and stored it safely.</span>
        </label>

        <button
          className={styles.continueBtn}
          onClick={onConfirmed}
          disabled={!confirmed}
        >
          Continue to vault
        </button>
      </div>
    </div>
  );
}

// ── Recovery phrase entry ──────────────────────────────────────────

export function RecoveryPage() {
  const navigate = useNavigate();
  const [words, setWords] = useState(Array(24).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setWord(i: number, value: string) {
    const next = [...words];
    next[i] = value.trim().toLowerCase();
    setWords(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (words.some((w) => !w)) {
      setError("Enter all 24 words");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const phrase = words.join(" ");
      void phrase; // TODO: pass to recovery API
      // TODO: call recovery API — unwrap vault key with recovery phrase,
      //       prompt for new master password, re-wrap and upload
      await new Promise((r) => setTimeout(r, 800));
      navigate("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={[styles.card, styles.cardWide].join(" ")}>
        <div className={styles.iconRow}>
          <span className={styles.icon}>🔓</span>
        </div>
        <h1 className={styles.title}>Recover your vault</h1>
        <p className={styles.desc}>
          Enter your 24-word recovery phrase to regain access to your vault.
        </p>

        <form onSubmit={handleSubmit}>
          <div className={styles.wordGrid}>
            {words.map((word, i) => (
              <div key={i} className={styles.wordCell}>
                <span className={styles.wordNum}>{i + 1}</span>
                <input
                  className={styles.wordInput}
                  value={word}
                  onChange={(e) => setWord(i, e.target.value)}
                  placeholder={`word ${i + 1}`}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            ))}
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" className={styles.continueBtn} disabled={loading}>
            {loading ? "Recovering…" : "Recover vault"}
          </button>
        </form>
      </div>
    </div>
  );
}
