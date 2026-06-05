import { StrictMode, useState, useEffect, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./popup.css";

// ── Types ──────────────────────────────────────────────────────────

interface VaultMatch {
  id: string;
  name: string;
  username: string;
}

type View = "locked" | "list" | "generator";

// ── Storage helpers ────────────────────────────────────────────────

async function getStatus(): Promise<{ locked: boolean }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
      resolve(res ?? { locked: true });
    });
  });
}

async function unlock(password: string): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "UNLOCK", password }, (res) => {
      resolve(res?.ok ?? false);
    });
  });
}

async function queryMatches(url: string): Promise<VaultMatch[]> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "AUTOFILL_QUERY", url }, (res) => {
      resolve(res?.matches ?? []);
    });
  });
}

async function autofill(itemId: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "AUTOFILL", itemId });
  }
}

// ── Password Generator (inline, no external deps) ──────────────────

function generatePassword(length = 20): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?";
  const charset = upper + lower + digits + symbols;
  const required = [
    upper[randomInt(upper.length)],
    lower[randomInt(lower.length)],
    digits[randomInt(digits.length)],
    symbols[randomInt(symbols.length)],
  ];
  const rest = Array.from({ length: length - required.length }, () => charset[randomInt(charset.length)]);
  const all = [...required, ...rest];
  // Fisher-Yates shuffle
  for (let i = all.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.join("");
}

function randomInt(max: number): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % max;
}

// ── Views ──────────────────────────────────────────────────────────

function LockedView({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const ok = await unlock(password);
    if (ok) {
      onUnlock();
    } else {
      setError("Incorrect master password");
    }
    setLoading(false);
  }

  return (
    <div className="view locked-view">
      <div className="header">
        <span className="logo">NS</span>
        <span className="brand">NadSafe</span>
      </div>
      <div className="locked-body">
        <div className="lock-icon">🔒</div>
        <p className="lock-label">Vault locked</p>
        <form onSubmit={handleSubmit} className="unlock-form">
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Master password"
            autoFocus
            required
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}

function ListView({
  matches,
  currentUrl,
  onGenerator,
  onLock,
}: {
  matches: VaultMatch[];
  currentUrl: string;
  onGenerator: () => void;
  onLock: () => void;
}) {
  const [filled, setFilled] = useState<string | null>(null);

  function handleAutofill(id: string) {
    autofill(id);
    setFilled(id);
    setTimeout(() => window.close(), 800);
  }

  const hostname = (() => {
    try { return new URL(currentUrl).hostname; } catch { return currentUrl; }
  })();

  return (
    <div className="view">
      <div className="header">
        <span className="logo">NS</span>
        <span className="brand">NadSafe</span>
        <div className="header-actions">
          <button className="icon-btn" onClick={onGenerator} title="Password generator">⚙</button>
          <button className="icon-btn" onClick={onLock} title="Lock vault">🔒</button>
        </div>
      </div>

      <div className="site-row">
        <span className="site-icon">🌐</span>
        <span className="site-name">{hostname}</span>
      </div>

      <div className="items">
        {matches.length === 0 ? (
          <div className="empty-state">
            <p>No saved logins for this site.</p>
            <button className="btn-outline" onClick={() => {
              chrome.tabs.create({ url: chrome.runtime.getURL("src/popup/popup.html") + "#add" });
            }}>
              + Save login
            </button>
          </div>
        ) : (
          matches.map((m) => (
            <button
              key={m.id}
              className={["item-row", filled === m.id ? "item-filled" : ""].join(" ")}
              onClick={() => handleAutofill(m.id)}
            >
              <div className="item-avatar">{m.name[0]?.toUpperCase()}</div>
              <div className="item-info">
                <span className="item-name">{m.name}</span>
                <span className="item-user">{m.username}</span>
              </div>
              <span className="item-arrow">{filled === m.id ? "✓" : "↵"}</span>
            </button>
          ))
        )}
      </div>

      <div className="footer">
        <a href="#" onClick={(e) => { e.preventDefault(); chrome.runtime.openOptionsPage?.(); }}
          className="footer-link">Open vault</a>
      </div>
    </div>
  );
}

function GeneratorView({ onBack }: { onBack: () => void }) {
  const [pw, setPw] = useState(() => generatePassword(20));
  const [length, setLength] = useState(20);
  const [copied, setCopied] = useState(false);

  function regen(len = length) {
    setPw(generatePassword(len));
    setCopied(false);
  }

  function copy() {
    navigator.clipboard.writeText(pw).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="view">
      <div className="header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span className="brand">Password Generator</span>
      </div>
      <div className="generator-body">
        <code className="pw-output">{pw}</code>
        <div className="gen-actions">
          <button className="btn-outline" onClick={() => regen()}>↻ New</button>
          <button className="btn-primary" onClick={copy}>{copied ? "✓ Copied" : "Copy"}</button>
        </div>
        <label className="gen-label">
          Length: <strong>{length}</strong>
          <input type="range" min={8} max={64} value={length}
            onChange={(e) => { const v = Number(e.target.value); setLength(v); regen(v); }}
            className="slider" />
        </label>
      </div>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────

function Popup() {
  const [view, setView] = useState<View>("locked");
  const [matches, setMatches] = useState<VaultMatch[]>([]);
  const [currentUrl, setCurrentUrl] = useState("");

  useEffect(() => {
    getStatus().then(({ locked }) => {
      if (!locked) loadMatches();
      else setView("locked");
    });
  }, []);

  async function loadMatches() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? "";
    setCurrentUrl(url);
    const m = await queryMatches(url);
    setMatches(m);
    setView("list");
  }

  function handleLock() {
    chrome.runtime.sendMessage({ type: "LOCK" });
    setView("locked");
  }

  if (view === "locked") return <LockedView onUnlock={loadMatches} />;
  if (view === "generator") return <GeneratorView onBack={() => setView("list")} />;
  return (
    <ListView
      matches={matches}
      currentUrl={currentUrl}
      onGenerator={() => setView("generator")}
      onLock={handleLock}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Popup /></StrictMode>,
);
