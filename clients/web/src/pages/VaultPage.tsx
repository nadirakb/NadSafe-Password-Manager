import { useState, useEffect, useRef, useCallback } from "react";
import { useVaultStore, type VaultItem, type ItemType } from "../stores/vault";
import { useVaultSync } from "../hooks/useVaultSync";
import { TotpDisplay } from "../components/TotpDisplay";
import { ItemModal } from "../components/ItemModal";
import { useAuthStore } from "../stores/auth";
import { clearSessionKey } from "../stores/session";
import styles from "./VaultPage.module.css";

const MOCK_ITEMS: VaultItem[] = [
  {
    id: "1", type: "login", name: "GitHub", folderId: null, collectionIds: [],
    favorite: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    login: { username: "nadir@example.com", password: "hunter2!", uris: ["https://github.com"], totp: null },
  },
  {
    id: "2", type: "login", name: "Booking Platform", folderId: null, collectionIds: ["col-booking"],
    favorite: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    login: { username: "admin@caletahomes.com", password: "Str0ngP@ss!", uris: ["https://extranet.booking.com"], totp: "JBSWY3DPEHPK3PXP" },
  },
  {
    id: "3", type: "note", name: "Server SSH Keys", folderId: null, collectionIds: ["col-infra"],
    favorite: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    note: { content: "Production keys stored in 1Password migration doc.\nDev keys in ~/.ssh/nadsafe_dev_rsa" },
  },
];

const TYPE_ICONS: Record<ItemType, string> = {
  login: "🔑", note: "📝", card: "💳", identity: "👤",
};

function ItemRow({ item, selected, onClick }: { item: VaultItem; selected: boolean; onClick: () => void }) {
  return (
    <button className={[styles.itemRow, selected ? styles.itemRowSelected : ""].join(" ")} onClick={onClick}>
      <span className={styles.itemIcon}>{TYPE_ICONS[item.type]}</span>
      <div className={styles.itemMeta}>
        <span className={styles.itemName}>{item.name}</span>
        {item.login?.username && <span className={styles.itemSub}>{item.login.username}</span>}
        {item.note && <span className={styles.itemSub}>Secure note</span>}
        {item.card && <span className={styles.itemSub}>{item.card.brand || "Card"} ···· {item.card.number?.slice(-4) || "····"}</span>}
        {item.type === "identity" && <span className={styles.itemSub}>Identity</span>}
      </div>
      {item.favorite && <span className={styles.star}>★</span>}
    </button>
  );
}

// ─── Card detail ─────────────────────────────────────────────────────────────

function CardDetail({ item, onEdit }: { item: VaultItem; onEdit: () => void }) {
  const [showCode, setShowCode] = useState(false);
  const [showNumber, setShowNumber] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function copy(value: string, field: string) {
    navigator.clipboard.writeText(value).catch(() => null);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  }

  if (!item.card) return null;
  const c = item.card;

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <span className={styles.detailIcon}>💳</span>
        <div style={{ flex: 1 }}>
          <h2 className={styles.detailTitle}>{item.name}</h2>
          {c.brand && <span className={styles.detailSub}>{c.brand}</span>}
        </div>
        <button className={styles.editBtn} onClick={onEdit}>Edit</button>
      </div>

      <div className={styles.fields}>
        {c.cardholderName && (
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Cardholder</label>
            <div className={styles.fieldRow}>
              <input className={styles.fieldInput} readOnly value={c.cardholderName} />
              <button className={styles.copyBtn} onClick={() => copy(c.cardholderName, "name")}>
                {copied === "name" ? "✓" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {c.number && (
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Card number</label>
            <div className={styles.fieldRow}>
              <input
                className={[styles.fieldInput, !showNumber ? styles.passwordMask : ""].join(" ")}
                readOnly
                value={showNumber ? c.number : `•••• •••• •••• ${c.number.slice(-4)}`}
                type="text"
                style={{ fontFamily: "var(--font-mono)" }}
              />
              <button className={styles.copyBtn} onClick={() => setShowNumber((v) => !v)}>
                {showNumber ? "Hide" : "Show"}
              </button>
              <button className={styles.copyBtn} onClick={() => copy(c.number, "number")}>
                {copied === "number" ? "✓" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {(c.expMonth || c.expYear) && (
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Expiry</label>
            <div className={styles.fieldRow}>
              <input className={styles.fieldInput} readOnly value={`${c.expMonth ?? "??"} / ${c.expYear ?? "????"}`} />
            </div>
          </div>
        )}

        {c.code && (
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Security code</label>
            <div className={styles.fieldRow}>
              <input
                className={[styles.fieldInput, !showCode ? styles.passwordMask : ""].join(" ")}
                readOnly value={c.code}
                type={showCode ? "text" : "password"}
                style={{ fontFamily: "var(--font-mono)" }}
              />
              <button className={styles.copyBtn} onClick={() => setShowCode((v) => !v)}>
                {showCode ? "Hide" : "Show"}
              </button>
              <button className={styles.copyBtn} onClick={() => copy(c.code, "code")}>
                {copied === "code" ? "✓" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={styles.detailFooter}>
        <span className={styles.timestamp}>Updated {new Date(item.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// ─── Login detail ─────────────────────────────────────────────────────────────

function LoginDetail({
  item,
  onEdit,
  hidePasswords,
}: {
  item: VaultItem;
  onEdit: () => void;
  hidePasswords?: boolean;
}) {
  const [revealPassword, setRevealPassword] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function copy(value: string, field: string) {
    navigator.clipboard.writeText(value).catch(() => null);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  }

  if (!item.login) return null;
  const login = item.login;

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <span className={styles.detailIcon}>{TYPE_ICONS[item.type]}</span>
        <div style={{ flex: 1 }}>
          <h2 className={styles.detailTitle}>{item.name}</h2>
        </div>
        <button className={styles.editBtn} onClick={onEdit}>Edit</button>
      </div>

      <div className={styles.fields}>
        {item.login.username && (
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Username</label>
            <div className={styles.fieldRow}>
              <input className={styles.fieldInput} readOnly value={item.login.username} />
              <button className={styles.copyBtn} onClick={() => copy(login.username, "username")}>
                {copied === "username" ? "✓" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {item.login.password && (
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Password</label>
            {hidePasswords ? (
              <div className={styles.fieldRow}>
                <input className={[styles.fieldInput, styles.passwordMask].join(" ")} readOnly
                  value="••••••••" type="password" disabled />
                <span className={styles.copyBtn} title="Password hidden by collection policy">🚫</span>
              </div>
            ) : (
              <div className={styles.fieldRow}>
                <input
                  className={[styles.fieldInput, !revealPassword ? styles.passwordMask : ""].join(" ")}
                  readOnly value={item.login.password}
                  type={revealPassword ? "text" : "password"}
                />
                <button className={styles.copyBtn} onClick={() => setRevealPassword((v) => !v)}>
                  {revealPassword ? "Hide" : "Show"}
                </button>
                <button className={styles.copyBtn} onClick={() => copy(login.password, "password")}>
                  {copied === "password" ? "✓" : "Copy"}
                </button>
              </div>
            )}
          </div>
        )}

        {item.login.uris.length > 0 && (
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>URL</label>
            <div className={styles.fieldRow}>
              <input className={styles.fieldInput} readOnly value={item.login.uris[0]} />
              <a href={item.login.uris[0]} target="_blank" rel="noopener noreferrer" className={styles.copyBtn}>
                Open ↗
              </a>
            </div>
          </div>
        )}

        {item.login.totp && (
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>One-Time Password</label>
            <TotpDisplay secret={item.login.totp} />
          </div>
        )}
      </div>

      <div className={styles.detailFooter}>
        <span className={styles.timestamp}>Updated {new Date(item.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// ─── Note detail ──────────────────────────────────────────────────────────────

function NoteDetail({ item, onEdit }: { item: VaultItem; onEdit: () => void }) {
  if (!item.note) return null;
  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <span className={styles.detailIcon}>📝</span>
        <div style={{ flex: 1 }}>
          <h2 className={styles.detailTitle}>{item.name}</h2>
        </div>
        <button className={styles.editBtn} onClick={onEdit}>Edit</button>
      </div>
      <div className={styles.fields}>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>Note</label>
          <textarea className={styles.noteArea} readOnly value={item.note.content} rows={12} />
        </div>
      </div>
      <div className={styles.detailFooter}>
        <span className={styles.timestamp}>Updated {new Date(item.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// ─── Identity detail ──────────────────────────────────────────────────────────

function IdentityDetail({ item, onEdit }: { item: VaultItem; onEdit: () => void }) {
  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <span className={styles.detailIcon}>👤</span>
        <div style={{ flex: 1 }}>
          <h2 className={styles.detailTitle}>{item.name}</h2>
        </div>
        <button className={styles.editBtn} onClick={onEdit}>Edit</button>
      </div>
      <div className={styles.fields}>
        {item.note?.content && (
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Details</label>
            <textarea className={styles.noteArea} readOnly value={item.note.content} rows={8} />
          </div>
        )}
      </div>
      <div className={styles.detailFooter}>
        <span className={styles.timestamp}>Updated {new Date(item.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// ─── Composite detail dispatcher ──────────────────────────────────────────────

function ItemDetail({
  item,
  onEdit,
  hidePasswords,
}: {
  item: VaultItem;
  onEdit: () => void;
  hidePasswords?: boolean;
}) {
  if (item.type === "card") return <CardDetail item={item} onEdit={onEdit} />;
  if (item.type === "note") return <NoteDetail item={item} onEdit={onEdit} />;
  if (item.type === "identity") return <IdentityDetail item={item} onEdit={onEdit} />;
  return <LoginDetail item={item} onEdit={onEdit} hidePasswords={hidePasswords} />;
}

// ─── Main vault page ──────────────────────────────────────────────────────────

export function VaultPage() {
  const {
    items: storeItems, selectedItemId, selectItem,
    searchQuery, setSearchQuery, isSyncing, lastSynced,
    selectedFolderId, selectedCollectionId, folders, collections,
  } = useVaultStore();
  const { doSync, error: syncError } = useVaultSync();
  const { lock, requires2FASetup, serverUrl } = useAuthStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!lastSynced) doSync();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts: Ctrl+L = lock, Ctrl+K = search, Esc = close modal
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ctrl+L — lock vault
    if ((e.ctrlKey || e.metaKey) && e.key === "l") {
      e.preventDefault();
      clearSessionKey();
      lock();
      return;
    }
    // Ctrl+K — focus search
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    // Esc — close open modal
    if (e.key === "Escape") {
      if (showAddModal) { setShowAddModal(false); return; }
      if (showEditModal) { setShowEditModal(false); return; }
    }
  }, [lock, showAddModal, showEditModal]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Show mocks only before first sync (UI preview). After sync: show real items or empty.
  const allItems = storeItems.length > 0 ? storeItems : lastSynced !== null ? [] : MOCK_ITEMS;

  // Filter by folder/collection/search
  const filtered = allItems.filter((i) => {
    if (selectedFolderId && i.folderId !== selectedFolderId) return false;
    if (selectedCollectionId && !i.collectionIds.includes(selectedCollectionId)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        i.name.toLowerCase().includes(q) ||
        (i.login?.username ?? "").toLowerCase().includes(q) ||
        (i.login?.uris[0] ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const selectedItem = filtered.find((i) => i.id === selectedItemId) ?? null;

  // Folder label for list header
  const activeFolder = selectedFolderId ? folders.find((f) => f.id === selectedFolderId) : null;
  // Collection hidePasswords policy for selected item
  const activeCollection = selectedItem
    ? collections.find((c) => selectedItem.collectionIds.includes(c.id) && c.hidePasswords)
    : null;
  const hidePasswords = !!activeCollection?.hidePasswords;

  return (
    <>
      {requires2FASetup && (
        <div style={{
          background: "var(--color-warning, #fef3c7)",
          borderBottom: "1px solid var(--color-warning-border, #f59e0b)",
          padding: "10px 20px",
          fontSize: "var(--font-size-sm)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          ⚠️ Your organization requires two-factor authentication.
          {" "}
          <a href={`${serverUrl}/#/settings/security/two-factor`} target="_blank" rel="noopener noreferrer"
            style={{ color: "var(--color-primary)", fontWeight: 600 }}>
            Set up 2FA in the web vault ↗
          </a>
        </div>
      )}
      <div className={styles.page}>
        {/* List */}
        <div className={styles.list}>
          <div className={styles.listHeader}>
            <input ref={searchRef} className={styles.searchInput} type="search" placeholder="Search vault… (⌘K)"
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            <button className={styles.addBtn} onClick={() => setShowAddModal(true)} title="Add item">+</button>
          </div>
          <div className={styles.listCount}>
            {isSyncing ? "Syncing…" : syncError ? `⚠ ${syncError}` : (
              <>
                {activeFolder ? `📁 ${activeFolder.name} · ` : ""}
                {filtered.length} item{filtered.length !== 1 ? "s" : ""}
              </>
            )}
            {!isSyncing && (
              <button onClick={doSync} title="Sync now"
                style={{ marginLeft: 8, fontSize: "var(--font-size-xs)", color: "var(--color-text-disabled)", background: "none", border: "none", cursor: "pointer" }}>
                ↻
              </button>
            )}
          </div>
          <div className={styles.listItems}>
            {filtered.length === 0
              ? <div className={styles.empty}>No items found</div>
              : filtered.map((item) => (
                <ItemRow key={item.id} item={item} selected={item.id === selectedItemId}
                  onClick={() => selectItem(item.id === selectedItemId ? null : item.id)} />
              ))}
          </div>
        </div>

        {/* Detail panel */}
        <div className={styles.panel}>
          {selectedItem
            ? <ItemDetail item={selectedItem} onEdit={() => setShowEditModal(true)} hidePasswords={hidePasswords} />
            : (
              <div className={styles.emptyDetail}>
                <span className={styles.emptyDetailIcon}>🔐</span>
                <p>Select an item to view details</p>
                <button className={styles.addItemCta} onClick={() => setShowAddModal(true)}>
                  + Add first item
                </button>
              </div>
            )}
        </div>
      </div>

      {showAddModal && (
        <ItemModal onClose={() => setShowAddModal(false)} onSaved={doSync} />
      )}
      {showEditModal && selectedItem && (
        <ItemModal item={selectedItem} onClose={() => setShowEditModal(false)} onSaved={doSync} />
      )}
    </>
  );
}
