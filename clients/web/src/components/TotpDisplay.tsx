import { useState, useEffect } from "react";
import { generateTotp, totpSecondsRemaining } from "../lib/totp";
import styles from "./TotpDisplay.module.css";

interface Props {
  secret: string;
}

export function TotpDisplay({ secret }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(totpSecondsRemaining());
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const c = await generateTotp(secret);
      setCode(c);
      setError(null);
    } catch {
      setError("Invalid TOTP secret");
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(() => {
      const s = totpSecondsRemaining();
      setSeconds(s);
      if (s === 30) refresh(); // new window started
    }, 1000);
    return () => clearInterval(interval);
  }, [secret]); // eslint-disable-line react-hooks/exhaustive-deps

  function copy() {
    if (!code) return;
    navigator.clipboard.writeText(code).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (error) return <span className={styles.error}>{error}</span>;
  if (!code) return <span className={styles.loading}>…</span>;

  const progress = (seconds / 30) * 100;
  const urgent = seconds <= 8;

  return (
    <div className={styles.container}>
      <div className={styles.codeRow}>
        <span className={[styles.code, urgent ? styles.urgent : ""].join(" ")}>
          {code.slice(0, 3)} {code.slice(3)}
        </span>
        <button className={styles.copyBtn} onClick={copy}>
          {copied ? "✓" : "Copy"}
        </button>
      </div>
      <div className={styles.progressBar}>
        <div
          className={[styles.progressFill, urgent ? styles.urgentFill : ""].join(" ")}
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className={styles.timer}>{seconds}s</span>
    </div>
  );
}
