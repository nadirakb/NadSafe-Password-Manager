import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./popup.css";

function NadSafeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M50 5 L95 20 L95 68 C95 87 50 97 50 97 C50 97 5 87 5 68 L5 20 Z" fill="#0f172a" stroke="#3b82f6" strokeWidth="2.5"/>
      <path d="M50 13 L87 26 L87 67 C87 81 50 90 50 90 C50 90 13 81 13 67 L13 26 Z" fill="none" stroke="#1e3a8a" strokeWidth="1.2"/>
      <path d="M33 64 L33 38 L67 64 L67 38" fill="none" stroke="#f59e0b" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="22" y="64" width="56" height="27" rx="5" fill="#1d4ed8" stroke="#3b82f6" strokeWidth="1.5"/>
      <circle cx="50" cy="75" r="5" fill="#bfdbfe"/>
      <rect x="47" y="75" width="6" height="9" rx="3" fill="#bfdbfe"/>
    </svg>
  );
}

// Polyfill: Firefox exposes `browser`, Chrome exposes `chrome`.
declare const browser: typeof chrome | undefined;
const ext = (typeof browser !== "undefined" ? browser : chrome);

// ── Types ──────────────────────────────────────────────────────────

interface VaultMatch {
  id: string;
  name: string;
  username: string;
  password?: string;
}

interface VaultItem {
  id: string;
  type: string;
  name: string;
  login?: { username: string; password: string; uris: string[]; totp: string | null };
}

type View = "locked" | "list" | "generator" | "settings";

type AliasService = "" | "simplelogin" | "anonaddy";

import { fuzzyMatch } from "../lib/fuzzy";

// ── Background messaging ───────────────────────────────────────────

function sendMsg<T>(msg: object): Promise<T> {
  return new Promise((resolve) =>
    ext.runtime.sendMessage(msg, (res) => resolve(res ?? ({} as T))),
  );
}

async function getStatus(): Promise<{ locked: boolean }> {
  return sendMsg({ type: "GET_STATUS" });
}

async function lockVault(): Promise<void> {
  await sendMsg({ type: "LOCK" });
}

async function syncVault(): Promise<{ ok: boolean; count?: number }> {
  return sendMsg({ type: "SYNC" });
}

async function getItems(): Promise<VaultItem[]> {
  const res = await sendMsg<{ items: VaultItem[] }>({ type: "GET_ITEMS" });
  return res.items ?? [];
}

async function queryMatches(url: string): Promise<VaultMatch[]> {
  const res = await sendMsg<{ matches: VaultMatch[] }>({ type: "AUTOFILL_QUERY", url });
  return res.matches ?? [];
}

async function autofill(itemId: string): Promise<void> {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) ext.tabs.sendMessage(tab.id, { type: "AUTOFILL", itemId });
}

// ── Password Generator ────────────────────────────────────────────

function generatePassword(length = 20): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?";
  const charset = upper + lower + digits + symbols;
  const required = [
    upper[ri(upper.length)], lower[ri(lower.length)],
    digits[ri(digits.length)], symbols[ri(symbols.length)],
  ];
  const rest = Array.from({ length: length - required.length }, () => charset[ri(charset.length)]);
  const all = [...required, ...rest];
  for (let i = all.length - 1; i > 0; i--) {
    const j = ri(i + 1);
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.join("");
}

function ri(max: number): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % max;
}

// ── Locked view ───────────────────────────────────────────────────

function LockedView({ onUnlock, onSettings, serverUrl }: { onUnlock: () => void; onSettings: () => void; serverUrl: string }) {
  return (
    <div className="view locked-view">
      <div className="header">
        <NadSafeIcon />
        <span className="brand">NadSafe</span>
        <div className="header-actions">
          <button className="icon-btn" onClick={onSettings} title="Settings">⚙</button>
        </div>
      </div>
      <div className="locked-body">
        <div className="lock-icon">🔒</div>
        <p className="lock-label">Vault locked</p>
        <p className="lock-hint">
          Open the NadSafe web app, then go to{" "}
          <strong>Settings → Browser Extension → Push to Extension</strong>
          {" "}to sync your vault.
        </p>
        <div className="lock-actions">
          <button
            className="btn-outline"
            onClick={() => ext.tabs.create({ url: serverUrl })}
          >
            Open NadSafe ↗
          </button>
          <button className="btn-primary" onClick={async () => {
            const { locked } = await getStatus();
            if (!locked) onUnlock();
          }}>
            Check status
          </button>
        </div>
      </div>
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────

function ListView({
  matches,
  allItems,
  currentUrl,
  serverUrl,
  onGenerator,
  onSettings,
  onLock,
  onSync,
}: {
  matches: VaultMatch[];
  allItems: VaultItem[];
  currentUrl: string;
  serverUrl: string;
  onGenerator: () => void;
  onSettings: () => void;
  onLock: () => void;
  onSync: () => void;
}) {
  const [filled, setFilled] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<"matches" | "all">(matches.length > 0 ? "matches" : "all");

  const hostname = (() => {
    try { return new URL(currentUrl).hostname; } catch { return currentUrl; }
  })();

  async function handleSync() {
    setSyncing(true);
    await onSync();
    setSyncing(false);
  }

  function handleAutofill(id: string) {
    autofill(id);
    setFilled(id);
    setTimeout(() => window.close(), 800);
  }

  const filteredAll = allItems
    .filter((i) => i.type === "login")
    .map((i) => {
      const nr = fuzzyMatch(i.name, search);
      const ur = fuzzyMatch(i.login?.username ?? "", search);
      return { item: i, match: nr.match || ur.match, score: Math.max(nr.score, ur.score) };
    })
    .filter(({ match }) => !search || match)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);

  return (
    <div className="view">
      <div className="header">
        <NadSafeIcon />
        <span className="brand">NadSafe</span>
        <div className="header-actions">
          <button className="icon-btn" onClick={handleSync} title="Sync vault" disabled={syncing}>
            {syncing ? "…" : "↻"}
          </button>
          <button className="icon-btn" onClick={onGenerator} title="Password generator">✦</button>
          <button className="icon-btn" onClick={onSettings} title="Settings">⚙</button>
          <button className="icon-btn" onClick={onLock} title="Lock vault">🔒</button>
        </div>
      </div>

      {hostname && (
        <div className="site-row">
          <span className="site-icon">🌐</span>
          <span className="site-name">{hostname}</span>
        </div>
      )}

      <div className="tab-row">
        <button
          className={["tab-btn", tab === "matches" ? "tab-active" : ""].join(" ")}
          onClick={() => setTab("matches")}
        >
          Matches ({matches.length})
        </button>
        <button
          className={["tab-btn", tab === "all" ? "tab-active" : ""].join(" ")}
          onClick={() => setTab("all")}
        >
          All items
        </button>
      </div>

      {tab === "all" && (
        <div className="search-row">
          <input
            className="search-input"
            type="search"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
      )}

      <div className="items">
        {tab === "matches" && matches.length === 0 && (
          <div className="empty-state">
            <p>No saved logins for this site.</p>
          </div>
        )}

        {tab === "matches" && matches.map((m) => (
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
        ))}

        {tab === "all" && filteredAll.length === 0 && (
          <div className="empty-state">
            <p>{search ? "No matches" : "No logins in vault"}</p>
          </div>
        )}

        {tab === "all" && filteredAll.map((item) => (
          <button
            key={item.id}
            className={["item-row", filled === item.id ? "item-filled" : ""].join(" ")}
            onClick={() => {
              handleAutofill(item.id);
            }}
          >
            <div className="item-avatar">{item.name[0]?.toUpperCase()}</div>
            <div className="item-info">
              <span className="item-name">{item.name}</span>
              <span className="item-user">{item.login?.username ?? ""}</span>
            </div>
            <span className="item-arrow">{filled === item.id ? "✓" : "↵"}</span>
          </button>
        ))}
      </div>

      <div className="footer">
        <span className="footer-count">{allItems.length} items synced</span>
        <a href="#" onClick={(e) => { e.preventDefault(); ext.tabs.create({ url: serverUrl }); }}
          className="footer-link">Open vault</a>
      </div>
    </div>
  );
}

// ── Generator view ────────────────────────────────────────────────

function GeneratorView({ onBack }: { onBack: () => void }) {
  const [pw, setPw] = useState(() => generatePassword(20));
  const [length, setLength] = useState(20);
  const [copied, setCopied] = useState(false);

  function regen(len = length) { setPw(generatePassword(len)); setCopied(false); }
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

// ── Settings view ─────────────────────────────────────────────────

function SettingsView({ onBack }: { onBack: () => void }) {
  const [service, setService] = useState<AliasService>("");
  const [apiKey, setApiKey] = useState("");
  const [base, setBase] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ext.storage.local.get(["aliasService", "aliasApiKey", "aliasBase"], (cfg) => {
      setService((cfg.aliasService as AliasService) ?? "");
      setApiKey(cfg.aliasApiKey ?? "");
      setBase(cfg.aliasBase ?? "");
      setLoading(false);
    });
  }, []);

  function handleSave() {
    ext.storage.local.set({ aliasService: service, aliasApiKey: apiKey, aliasBase: base }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  if (loading) return <div className="view"><div style={{ padding: "20px", color: "var(--text-muted)" }}>Loading…</div></div>;

  return (
    <div className="view">
      <div className="header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span className="brand">Settings</span>
      </div>
      <div className="generator-body">
        <div className="settings-group">
          <div className="settings-label">Email alias service</div>
          <p className="settings-hint">
            Create disposable aliases from email fields on any site. NadSafe fills the alias instead of your real address.
          </p>
          <select
            className="settings-select"
            value={service}
            onChange={(e) => setService(e.target.value as AliasService)}
          >
            <option value="">None</option>
            <option value="simplelogin">SimpleLogin</option>
            <option value="anonaddy">AnonAddy</option>
          </select>
        </div>

        {service && (
          <div className="settings-group">
            <div className="settings-label">API key</div>
            <input
              className="input settings-input"
              type="password"
              placeholder={service === "simplelogin" ? "SL-… (from simplelogin.io)" : "Bearer token from anonaddy.com"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
        )}

        {service === "anonaddy" && (
          <div className="settings-group">
            <div className="settings-label">Instance URL <span style={{ color: "var(--text-disabled)" }}>(optional)</span></div>
            <input
              className="input settings-input"
              type="url"
              placeholder="https://app.anonaddy.com"
              value={base}
              onChange={(e) => setBase(e.target.value)}
            />
          </div>
        )}

        <button className="btn-primary" style={{ marginTop: "4px" }} onClick={handleSave}>
          {saved ? "✓ Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────

function Popup() {
  const [view, setView] = useState<View>("locked");
  const [matches, setMatches] = useState<VaultMatch[]>([]);
  const [allItems, setAllItems] = useState<VaultItem[]>([]);
  const [currentUrl, setCurrentUrl] = useState("");
  const [serverUrl, setServerUrl] = useState("http://localhost:5173");

  useEffect(() => {
    getStatus().then(({ locked }) => {
      if (!locked) loadVault();
      else setView("locked");
    });
    // Load stored serverUrl for "Open vault" links
    ext.storage.session.get(["serverUrl"]).then((s) => {
      const url = (s as Record<string, string>).serverUrl;
      if (url) setServerUrl(url);
    });
  }, []);

  async function loadVault() {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? "";
    setCurrentUrl(url);

    const [m, items] = await Promise.all([
      queryMatches(url),
      getItems(),
    ]);
    setMatches(m);
    setAllItems(items);
    setView("list");
  }

  async function handleSync() {
    await syncVault();
    await loadVault();
  }

  function handleLock() {
    lockVault();
    setView("locked");
  }

  if (view === "locked") return <LockedView onUnlock={loadVault} onSettings={() => setView("settings")} serverUrl={serverUrl} />;
  if (view === "generator") return <GeneratorView onBack={() => setView("list")} />;
  if (view === "settings") return <SettingsView onBack={() => setView("list")} />;
  return (
    <ListView
      matches={matches}
      allItems={allItems}
      currentUrl={currentUrl}
      serverUrl={serverUrl}
      onGenerator={() => setView("generator")}
      onSettings={() => setView("settings")}
      onLock={handleLock}
      onSync={handleSync}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Popup /></StrictMode>,
);
