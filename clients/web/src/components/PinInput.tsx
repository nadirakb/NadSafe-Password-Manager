import { useEffect, useRef } from "react";

/** Proton-style PIN entry: a row of dots backed by a hidden numeric input. */
export function PinInput({ length, value, onChange, onComplete, autoFocus, disabled }: {
  length: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  return (
    <div
      onClick={() => ref.current?.focus()}
      style={{ position: "relative", display: "flex", justifyContent: "center", gap: 16, padding: "14px 0", cursor: disabled ? "default" : "text" }}
    >
      {Array.from({ length }).map((_, i) => (
        <span key={i} style={{
          width: 15, height: 15, borderRadius: "50%",
          background: i < value.length ? "var(--color-primary, #3b82f6)" : "transparent",
          border: `2px solid ${i < value.length ? "var(--color-primary, #3b82f6)" : "var(--color-border, #475569)"}`,
          transition: "background .1s, border-color .1s",
        }} />
      ))}
      <input
        ref={ref}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        value={value}
        maxLength={length}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, length);
          onChange(digits);
          if (digits.length === length) onComplete?.(digits);
        }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, border: "none", cursor: disabled ? "default" : "text" }}
      />
    </div>
  );
}
