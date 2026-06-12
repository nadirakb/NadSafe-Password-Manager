import { useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { useVaultStore } from "../stores/vault";
import { lockVault } from "../stores/lock";
import { useFolderActions } from "../hooks/useFolders";
import { NadSafeLogo } from "./NadSafeLogo";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { to: "/vault", label: "All Items", icon: "⊞" },
  { to: "/organizations", label: "Organizations", icon: "🏢" },
  { to: "/import", label: "Import", icon: "📥" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const { user } = useAuthStore();
  const handleLock = lockVault;

  const { folders, collections, selectedFolderId, selectFolder, selectedCollectionId, selectCollection } = useVaultStore();
  const { doCreate, doDelete, doRename } = useFolderActions();

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);

  async function handleCreateFolder(e: FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setFolderError(null);
    try {
      await doCreate(newFolderName.trim());
      setNewFolderName("");
      setShowNewFolder(false);
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Create failed");
    }
  }

  async function handleDeleteFolder(id: string, name: string) {
    if (!confirm(`Delete folder "${name}"? Items inside will lose their folder assignment.`)) return;
    try { await doDelete(id); } catch { /* ignore */ }
    if (selectedFolderId === id) selectFolder(null);
  }

  async function handleRenameFolder(id: string, currentName: string) {
    const next = prompt("Rename folder:", currentName);
    if (!next || next === currentName) return;
    try { await doRename(id, next.trim()); } catch { /* ignore */ }
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <NadSafeLogo size={32} />
        <span className={styles.brandName}>NadSafe</span>
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              [styles.navItem, isActive ? styles.active : ""].join(" ")
            }
            onClick={() => { selectFolder(null); selectCollection(null); }}
          >
            <span className={styles.navIcon}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Folders */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Folders</h3>
          <button className={styles.sectionAddBtn} onClick={() => setShowNewFolder((v) => !v)} title="New folder">
            +
          </button>
        </div>

        {showNewFolder && (
          <form onSubmit={handleCreateFolder} className={styles.newFolderForm}>
            <input
              className={styles.newFolderInput}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              autoFocus
            />
            <button type="submit" className={styles.newFolderSave}>✓</button>
            <button type="button" className={styles.newFolderCancel} onClick={() => setShowNewFolder(false)}>✕</button>
          </form>
        )}
        {folderError && <p className={styles.sectionError}>{folderError}</p>}

        {folders.map((f) => (
          <div
            key={f.id}
            className={[styles.folderItem, selectedFolderId === f.id ? styles.folderItemActive : ""].join(" ")}
            onClick={() => selectFolder(selectedFolderId === f.id ? null : f.id)}
          >
            <span className={styles.navIcon}>📁</span>
            <span className={styles.folderName}>{f.name}</span>
            <div className={styles.folderActions}>
              <button className={styles.folderActionBtn}
                onClick={(e) => { e.stopPropagation(); handleRenameFolder(f.id, f.name); }}
                title="Rename">✎</button>
              <button className={styles.folderActionBtn}
                onClick={(e) => { e.stopPropagation(); handleDeleteFolder(f.id, f.name); }}
                title="Delete">🗑</button>
            </div>
          </div>
        ))}

        {folders.length === 0 && !showNewFolder && (
          <p className={styles.sectionEmpty}>No folders yet</p>
        )}
      </section>

      {/* Collections */}
      {collections.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Collections</h3>
          {collections.map((c) => (
            <button
              key={c.id}
              className={[styles.navItem, selectedCollectionId === c.id ? styles.active : ""].join(" ")}
              onClick={() => selectCollection(selectedCollectionId === c.id ? null : c.id)}
            >
              <span className={styles.navIcon}>📂</span>
              {c.name}
            </button>
          ))}
        </section>
      )}

      <div className={styles.footer}>
        <div className={styles.userInfo}>
          <div className={styles.avatar}>
            {user?.name?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div className={styles.userDetails}>
            <span className={styles.userName}>{user?.name}</span>
            <span className={styles.userEmail}>{user?.email}</span>
          </div>
        </div>
        <button className={styles.logoutBtn} onClick={handleLock} title="Lock vault">
          🔒
        </button>
      </div>
    </aside>
  );
}
