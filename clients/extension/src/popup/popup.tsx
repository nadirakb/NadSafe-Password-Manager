import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./popup.css";

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

type View = "locked" | "list" | "generator";

// ── Fuzzy search ──────────────────────────────────────────────────

/** Subsequence fuzzy match. Returns {match, score} where higher score = better. */
function fuzzyMatch(text: string, query: string): { match: boolean; score: number } {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return { match: true, score: 0 };
  // Exact substring — best
  const exactIdx = t.indexOf(q);
  if (exactIdx !== -1) return { match: true, score: 1000 - exactIdx };
  // Word-start prefix — next best
  const words = t.split(/[\s._/-]+/);
  for (const w of words) {
    if (w.startsWith(q)) return { match: true, score: 500 };
  }
  // Subsequence — each char of q must appear in order in t
  let ti = 0, qi = 0, score = 0;
  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) { score++; qi++; }
    ti++;
  }
  return { match: qi === q.length, score };
}

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

function LockedView({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div className="view locked-view">
      <div className="header">
        <span className="logo">NS</span>
        <span className="brand">NadSafe</span>
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
            onClick={() => ext.tabs.create({ url: "http://localhost:5173" })}
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
  onGenerator,
  onLock,
  onSync,
}: {
  matches: VaultMatch[];
  allItems: VaultItem[];
  currentUrl: string;
  onGenerator: () => void;
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
        <span className="logo">NS</span>
        <span className="brand">NadSafe</span>
        <div className="header-actions">
          <button className="icon-btn" onClick={handleSync} title="Sync vault" disabled={syncing}>
            {syncing ? "…" : "↻"}
          </button>
          <button className="icon-btn" onClick={onGenerator} title="Password generator">⚙</button>
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
        <a href="#" onClick={(e) => { e.preventDefault(); ext.tabs.create({ url: "http://localhost:5173" }); }}
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

// ── Root ───────────────────────────────────────────────────────────

function Popup() {
  const [view, setView] = useState<View>("locked");
  const [matches, setMatches] = useState<VaultMatch[]>([]);
  const [allItems, setAllItems] = useState<VaultItem[]>([]);
  const [currentUrl, setCurrentUrl] = useState("");

  useEffect(() => {
    getStatus().then(({ locked }) => {
      if (!locked) loadVault();
      else setView("locked");
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

  if (view === "locked") return <LockedView onUnlock={loadVault} />;
  if (view === "generator") return <GeneratorView onBack={() => setView("list")} />;
  return (
    <ListView
      matches={matches}
      allItems={allItems}
      currentUrl={currentUrl}
      onGenerator={() => setView("generator")}
      onLock={handleLock}
      onSync={handleSync}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Popup /></StrictMode>,
);
