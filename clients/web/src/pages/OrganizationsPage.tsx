import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getApiClient } from "../lib/api/client";
import { listOrgs, type OrgResponse } from "../lib/api/orgs";
import { useCreateOrg } from "../hooks/useOrg";
import styles from "./Organizations.module.css";

export function OrganizationsPage() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<OrgResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [collectionName, setCollectionName] = useState("Default Collection");
  const { doCreate, loading: creating, error: createError } = useCreateOrg();

  useEffect(() => {
    listOrgs(getApiClient())
      .then(setOrgs)
      .catch(() => setOrgs([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    await doCreate(orgName, collectionName, (org) => {
      setOrgs((prev) => [...prev, org]);
      setShowCreate(false);
      setOrgName("");
      navigate(`/organizations/${org.id}/members`);
    });
  }

  const roleLabels = ["Owner", "Admin", "User", "Manager"];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Organizations</h1>
        <button className={styles.createBtn} onClick={() => setShowCreate(true)}>
          + New organization
        </button>
      </header>

      {loading && <p className={styles.muted}>Loading…</p>}

      {!loading && orgs.length === 0 && !showCreate && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🏢</span>
          <h2>No organizations yet</h2>
          <p>Create an organization to share credentials with your team using groups and collections.</p>
          <button className={styles.createBtnLarge} onClick={() => setShowCreate(true)}>
            Create your first organization
          </button>
        </div>
      )}

      <div className={styles.orgGrid}>
        {orgs.map((org) => (
          <button
            key={org.id}
            className={styles.orgCard}
            onClick={() => navigate(`/organizations/${org.id}/members`)}
          >
            <div className={styles.orgAvatar}>{org.name[0]?.toUpperCase()}</div>
            <div className={styles.orgInfo}>
              <span className={styles.orgName}>{org.name}</span>
              <span className={styles.orgRole}>{roleLabels[org.type] ?? "Member"}</span>
            </div>
            <span className={styles.arrow}>→</span>
          </button>
        ))}
      </div>

      {showCreate && (
        <div className={styles.overlay} onClick={() => setShowCreate(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Create organization</h2>
            <form onSubmit={handleCreate} className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label}>Organization name</label>
                <input
                  className={styles.input}
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme Corp"
                  required
                  autoFocus
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>First collection name</label>
                <input
                  className={styles.input}
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  placeholder="Default Collection"
                  required
                />
              </div>
              {createError && <p className={styles.error}>{createError}</p>}
              <div className={styles.actions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className={styles.submitBtn} disabled={creating}>
                  {creating ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
