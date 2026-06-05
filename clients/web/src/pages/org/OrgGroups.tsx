import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { getApiClient } from "../../lib/api/client";
import { createGroup, deleteGroup, type OrgGroupResponse, type OrgResponse } from "../../lib/api/orgs";
import { useOrgGroups } from "../../hooks/useOrg";
import styles from "./Org.module.css";

type Ctx = { org: OrgResponse; orgId: string };

export function OrgGroups() {
  const { orgId } = useOutletContext<Ctx>();
  const { groups, loading, error, reload } = useOrgGroups(orgId);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => { reload(); }, [reload]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createGroup(getApiClient(), orgId, { name: newName, accessAll: false, collections: [] });
      setNewName("");
      reload();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(group: OrgGroupResponse) {
    if (!confirm(`Delete group "${group.name}"?`)) return;
    try {
      await deleteGroup(getApiClient(), orgId, group.id);
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className={styles.tabPanel}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Groups</h2>
        <span className={styles.badge}>{groups.length}</span>
      </div>

      <form onSubmit={handleCreate} className={styles.inlineForm}>
        <input
          className={styles.input}
          placeholder="e.g. Front Desk"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
        />
        <button type="submit" className={styles.btnPrimary} disabled={creating}>
          {creating ? "Creating…" : "+ Create group"}
        </button>
      </form>
      {createError && <p className={styles.error}>{createError}</p>}

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.muted}>Loading…</p>}

      {groups.length === 0 && !loading && (
        <div className={styles.emptyState}>
          <p>No groups yet. Create a group to manage member access.</p>
        </div>
      )}

      <div className={styles.cardGrid}>
        {groups.map((g) => (
          <div key={g.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardIcon}>🏷</span>
              <span className={styles.cardName}>{g.name}</span>
            </div>
            <div className={styles.cardMeta}>
              <span className={styles.muted}>{g.users.length} member{g.users.length !== 1 ? "s" : ""}</span>
              <span className={styles.muted}>{g.collections.length} collection{g.collections.length !== 1 ? "s" : ""}</span>
            </div>
            <button className={styles.btnDanger} onClick={() => handleDelete(g)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
