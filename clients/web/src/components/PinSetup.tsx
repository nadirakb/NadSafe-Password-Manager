import { useState, type CSSProperties } from "react";
import { PinInput } from "./PinInput";
import { setPin } from "../lib/crypto/pin";
import { getSessionUserKey } from "../stores/session";

/** Modal: choose a 4/6-digit PIN, confirm it, and wrap the user key under it. */
export function PinSetup({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [length, setLength] = useState<4 | 6>(4);
  const [stage, setStage] = useState<"enter" | "confirm">("enter");
  const [first, setFirst] = useState("");
  const [pin, setPinValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function restart(len: 4 | 6) {
    setLength(len); setStage("enter"); setFirst(""); setPinValue(""); setError(null);
  }

  async function onComplete(value: string) {
    if (stage === "enter") {
      setFirst(value); setPinValue(""); setStage("confirm"); setError(null);
      return;
    }
    if (value !== first) {
      setError("PINs don't match — start over");
      setStage("enter"); setFirst(""); setPinValue("");
      return;
    }
    const userKey = getSessionUserKey();
    if (!userKey) { setError("Vault is locked"); return; }
    setBusy(true); setError(null);
    try {
      await setPin(value, userKey);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not set PIN");
      setStage("enter"); setFirst(""); setPinValue("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 6px", textAlign: "center" }}>
          {stage === "enter" ? "Set a PIN" : "Confirm PIN"}
        </h3>

        {stage === "enter" && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 8 }}>
            <button type="button" onClick={() => restart(4)} style={lenBtn(length === 4)}>4 digits</button>
            <button type="button" onClick={() => restart(6)} style={lenBtn(length === 6)}>6 digits</button>
          </div>
        )}

        <p style={{ color: "var(--color-text-muted)", fontSize: 13, textAlign: "center", margin: 0 }}>
          {stage === "enter" ? "Choose a quick-unlock PIN." : "Re-enter your PIN to confirm."}
        </p>

        <PinInput key={stage} length={length} value={pin} onChange={setPinValue} onComplete={onComplete} autoFocus disabled={busy} />

        {error && <p style={{ color: "#ef4444", fontSize: 13, textAlign: "center", margin: 0 }}>{error}</p>}

        <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
      </div>
    </div>
  );
}

const overlay: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};

const modal: CSSProperties = {
  width: 320, maxWidth: "90vw", padding: 24, borderRadius: 14,
  background: "var(--color-surface, #1e293b)", border: "1px solid var(--color-border, #334155)",
  boxShadow: "0 16px 48px rgba(0,0,0,0.5)", color: "var(--color-text, #e2e8f0)",
  display: "flex", flexDirection: "column", gap: 8,
};

function lenBtn(active: boolean): CSSProperties {
  return {
    flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
    border: `1px solid ${active ? "var(--color-primary, #3b82f6)" : "var(--color-border, #334155)"}`,
    background: active ? "var(--color-primary, #3b82f6)" : "transparent",
    color: active ? "#fff" : "var(--color-text-muted, #94a3b8)",
  };
}

const cancelBtn: CSSProperties = {
  marginTop: 4, padding: "8px 0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
  border: "1px solid var(--color-border, #334155)", background: "transparent",
  color: "var(--color-text-muted, #94a3b8)",
};
