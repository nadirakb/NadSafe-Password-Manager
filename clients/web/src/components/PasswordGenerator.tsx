import { useState, useCallback } from "react";
import {
  generatePassword,
  passwordEntropy,
  DEFAULT_PASSWORD_CONFIG,
  type PasswordConfig,
} from "../lib/password-gen";
import styles from "./PasswordGenerator.module.css";

interface Props {
  onSelect: (password: string) => void;
  onClose: () => void;
}

export function PasswordGenerator({ onSelect, onClose }: Props) {
  const [config, setConfig] = useState<PasswordConfig>(DEFAULT_PASSWORD_CONFIG);
  const [password, setPassword] = useState(() => generatePassword(DEFAULT_PASSWORD_CONFIG));

  const regenerate = useCallback((cfg: PasswordConfig = config) => {
    try {
      setPassword(generatePassword(cfg));
    } catch {
      // no-op if config is invalid
    }
  }, [config]);

  function update(partial: Partial<PasswordConfig>) {
    const next = { ...config, ...partial };
    setConfig(next);
    regenerate(next);
  }

  const entropy = passwordEntropy(password);
  const entropyColor =
    entropy >= 80 ? "#22c55e" : entropy >= 60 ? "#eab308" : "#ef4444";

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>Password Generator</h3>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.output}>
          <code className={styles.password}>{password}</code>
          <div className={styles.outputActions}>
            <span style={{ fontSize: "var(--font-size-xs)", color: entropyColor }}>
              ~{entropy} bits
            </span>
            <button className={styles.actionBtn} onClick={() => regenerate()}>↻ Regenerate</button>
            <button className={styles.actionBtn} onClick={() => navigator.clipboard.writeText(password)}>Copy</button>
          </div>
        </div>

        <div className={styles.controls}>
          <div className={styles.lengthRow}>
            <label className={styles.controlLabel}>Length</label>
            <div className={styles.lengthControl}>
              <input
                type="range"
                min={8}
                max={128}
                value={config.length}
                onChange={(e) => update({ length: Number(e.target.value) })}
                className={styles.slider}
              />
              <input
                type="number"
                min={8}
                max={128}
                value={config.length}
                onChange={(e) => update({ length: Number(e.target.value) })}
                className={styles.lengthNum}
              />
            </div>
          </div>

          <div className={styles.checkboxGrid}>
            {([
              ["uppercase", "A–Z"],
              ["lowercase", "a–z"],
              ["numbers", "0–9"],
              ["symbols", "!@#…"],
              ["avoidAmbiguous", "No ambiguous"],
            ] as [keyof PasswordConfig, string][]).map(([key, label]) => (
              <label key={key} className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={Boolean(config[key])}
                  onChange={(e) => update({ [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <button
          className={styles.useBtn}
          onClick={() => { onSelect(password); onClose(); }}
        >
          Use this password
        </button>
      </div>
    </div>
  );
}
