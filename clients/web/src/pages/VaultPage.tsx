import { useState } from "react";
import { useVaultStore, type VaultItem, type ItemType } from "../stores/vault";
import styles from "./VaultPage.module.css";

const MOCK_ITEMS: VaultItem[] = [
  {
    id: "1",
    type: "login",
    name: "GitHub",
    folderId: null,
    collectionIds: [],
    favorite: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    login: {
      username: "nadir@example.com",
      password: "••••••••••••",
      uris: ["https://github.com"],
      totp: null,
    },
  },
  {
    id: "2",
    type: "login",
    name: "Booking Platform — Admin",
    folderId: null,
    collectionIds: ["col-booking"],
    favorite: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    login: {
      username: "admin@caletahomes.com",
      password: "••••••••••••",
      uris: ["https://extranet.booking.com"],
      totp: "JBSWY3DPEHPK3PXP",
    },
  },
  {
    id: "3",
    type: "note",
    name: "Server SSH Keys",
    folderId: null,
    collectionIds: ["col-infra"],
    favorite: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    note: { content: "See 1Password migration doc for key details." },
  },
];

const TYPE_ICONS: Record<ItemType, string> = {
  login: "🔑",
  note: "📝",
  card: "💳",
  identity: "👤",
};

function ItemRow({
  item,
  selected,
  onClick,
}: {
  item: VaultItem;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={[styles.itemRow, selected ? styles.itemRowSelected : ""].join(" ")}
      onClick={onClick}
    >
      <span className={styles.itemIcon}>{TYPE_ICONS[item.type]}</span>
      <div className={styles.itemMeta}>
        <span className={styles.itemName}>{item.name}</span>
        {item.login && (
          <span className={styles.itemSub}>{item.login.username}</span>
        )}
        {item.note && <span className={styles.itemSub}>Secure note</span>}
      </div>
      {item.favorite && <span className={styles.star}>★</span>}
    </button>
  );
}

function ItemDetail({ item }: { item: VaultItem }) {
  const [revealPassword, setRevealPassword] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function copy(value: string, field: string) {
    navigator.clipboard.writeText(value).catch(() => null);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <span className={styles.detailIcon}>{TYPE_ICONS[item.type]}</span>
        <h2 className={styles.detailTitle}>{item.name}</h2>
      </div>

      {item.login && (
        <div className={styles.fields}>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Username</label>
            <div className={styles.fieldRow}>
              <input
                className={styles.fieldInput}
                readOnly
                value={item.login.username}
              />
              <button
                className={styles.copyBtn}
                onClick={() => copy(item.login!.username, "username")}
              >
                {copied === "username" ? "✓" : "Copy"}
              </button>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Password</label>
            <div className={styles.fieldRow}>
              <input
                className={[styles.fieldInput, !revealPassword ? styles.passwordMask : ""].join(" ")}
                readOnly
                value={item.login.password}
                type={revealPassword ? "text" : "password"}
              />
              <button
                className={styles.copyBtn}
                onClick={() => setRevealPassword((v) => !v)}
              >
                {revealPassword ? "Hide" : "Show"}
              </button>
              <button
                className={styles.copyBtn}
                onClick={() => copy(item.login!.password, "password")}
              >
                {copied === "password" ? "✓" : "Copy"}
              </button>
            </div>
          </div>

          {item.login.uris.length > 0 && (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>URL</label>
              <div className={styles.fieldRow}>
                <input
                  className={styles.fieldInput}
                  readOnly
                  value={item.login.uris[0]}
                />
                <a
                  href={item.login.uris[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.copyBtn}
                >
                  Open ↗
                </a>
              </div>
            </div>
          )}

          {item.login.totp && (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>TOTP secret stored</label>
              <div className={styles.totpBadge}>2FA enabled</div>
            </div>
          )}
        </div>
      )}

      {item.note && (
        <div className={styles.fields}>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Note</label>
            <textarea
              className={styles.noteArea}
              readOnly
              value={item.note.content}
              rows={8}
            />
          </div>
        </div>
      )}

      <div className={styles.detailFooter}>
        <span className={styles.timestamp}>
          Updated {new Date(item.updatedAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

export function VaultPage() {
  const { items: storeItems, selectedItemId, selectItem, searchQuery, setSearchQuery } =
    useVaultStore();

  // Use mock items if store is empty (development mode)
  const allItems = storeItems.length > 0 ? storeItems : MOCK_ITEMS;

  const filtered = allItems.filter(
    (i) =>
      !searchQuery ||
      i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.login?.username.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const selectedItem = filtered.find((i) => i.id === selectedItemId) ?? null;

  return (
    <div className={styles.page}>
      {/* Item list */}
      <div className={styles.list}>
        <div className={styles.listHeader}>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search vault…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button className={styles.addBtn} title="Add item">+</button>
        </div>

        <div className={styles.listCount}>
          {filtered.length} {filtered.length === 1 ? "item" : "items"}
        </div>

        <div className={styles.listItems}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>No items found</div>
          ) : (
            filtered.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                selected={item.id === selectedItemId}
                onClick={() => selectItem(item.id === selectedItemId ? null : item.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Item detail panel */}
      <div className={styles.panel}>
        {selectedItem ? (
          <ItemDetail item={selectedItem} />
        ) : (
          <div className={styles.emptyDetail}>
            <span className={styles.emptyDetailIcon}>🔐</span>
            <p>Select an item to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}
