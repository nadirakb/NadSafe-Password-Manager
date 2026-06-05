import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { getApiClient } from "../../lib/api/client";
import { createCollection, deleteCollection, type OrgCollectionResponse, type OrgResponse } from "../../lib/api/orgs";
import { useOrgCollections } from "../../hooks/useOrg";
import { getSessionUserKey } from "../../stores/session";
import { encryptField, decryptField } from "../../lib/crypto/key-hierarchy";
import styles from "./Org.module.css";

type Ctx = { org: OrgResponse; orgId: string };

export function OrgCollections() {
  const { orgId } = useOutletContext<Ctx>();
  const { collections, loading, error, reload } = useOrgCollections(orgId);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({});

  useEffect(() => { reload(); }, [reload]);

  // Try to decrypt collection names with user key as a fallback
  useEffect(() => {
    const userKey = getSessionUserKey();
    if (!userKey || collections.length === 0) return;
    Promise.all(
      collections.map(async (c) => {
        try {
          const name = await decryptField(c.name, userKey);
          return [c.id, name ?? c.name] as const;
        } catch {
          return [c.id, c.name] as const;
        }
      }),
    ).then((entries) => setDecryptedNames(Object.fromEntries(entries)));
  }, [collections]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const userKey = getSessionUserKey();
    if (!userKey) { setCreateError("Vault locked"); return; }
    setCreating(true);
    setCreateError(null);
    try {
      // Encrypt collection name with user key (org key not available in this simplified flow)
      const encName = await encryptField(newName, userKey);
      await createCollection(getApiClient(), orgId, { name: encName, groups: [], users: [] });
      setNewName("");
      reload();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(c: OrgCollectionResponse) {
    if (!confirm(`Delete collection "${decryptedNames[c.id] ?? c.name}"?`)) return;
    try {
      await deleteCollection(getApiClient(), orgId, c.id);
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className={styles.tabPanel}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Collections</h2>
        <span className={styles.badge}>{collections.length}</span>
      </div>

      <form onSubmit={handleCreate} className={styles.inlineForm}>
        <input
          className={styles.input}
          placeholder="e.g. Infrastructure"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
        />
        <button type="submit" className={styles.btnPrimary} disabled={creating}>
          {creating ? "Creating…" : "+ Create collection"}
        </button>
      </form>
      {createError && <p className={styles.error}>{createError}</p>}

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.muted}>Loading…</p>}

      {collections.length === 0 && !loading && (
        <div className={styles.emptyState}>
          <p>No collections yet. Collections let you share groups of items with specific teams.</p>
        </div>
      )}

      <div className={styles.cardGrid}>
        {collections.map((c) => (
          <div key={c.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardIcon}>📂</span>
              <span className={styles.cardName}>{decryptedNames[c.id] ?? "…"}</span>
            </div>
            <div className={styles.cardMeta}>
              {c.readOnly && <span className={styles.permBadge}>Read-only</span>}
              {c.hidePasswords && <span className={styles.permBadge}>Hide passwords</span>}
              {c.manage && <span className={styles.permBadge}>Manage</span>}
            </div>
            <button className={styles.btnDanger} onClick={() => handleDelete(c)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
