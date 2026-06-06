import { useState } from "react";
import { entropyToPhrase } from "../lib/crypto/recovery";
import styles from "./ShowRecoveryPhrase.module.css";

interface Props {
  entropy: Uint8Array;
  onDismiss: () => void;
}

export function ShowRecoveryPhrase({ entropy, onDismiss }: Props) {
  const phrase = entropyToPhrase(entropy);
  const words = phrase.split(" ");
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(phrase).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.icon}>🛡️</span>
          <h2 className={styles.title}>Save your recovery phrase</h2>
        </div>

        <p className={styles.desc}>
          This phrase is the <strong>only way to recover your vault</strong> if you forget your
          master password. Write it down and store it somewhere safe.
        </p>

        <div className={styles.warning}>
          ⚠️ <strong>Device-local:</strong> this phrase is stored only on this device.
          If you lose this device without noting the phrase below, your vault is{" "}
          <strong>permanently unrecoverable</strong>. NadSafe has no server copy.
        </div>

        <div className={styles.phraseGrid}>
          {words.map((word, i) => (
            <div key={i} className={styles.phraseWord}>
              <span className={styles.wordIndex}>{i + 1}</span>
              <span className={styles.wordText}>{word}</span>
            </div>
          ))}
        </div>

        <button className={styles.copyBtn} onClick={handleCopy}>
          {copied ? "✓ Copied!" : "Copy to clipboard"}
        </button>

        <label className={styles.confirmLabel}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I have written down my recovery phrase and stored it safely
        </label>

        <div className={styles.actions}>
          <button className={styles.dismissBtn} onClick={onDismiss} disabled={!confirmed}>
            Continue to vault →
          </button>
        </div>
      </div>
    </div>
  );
}
