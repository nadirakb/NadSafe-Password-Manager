import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { getApiClient } from "../../lib/api/client";
import { inviteMembers, removeOrgMember, type OrgMemberResponse, type OrgResponse } from "../../lib/api/orgs";
import { useOrgMembers } from "../../hooks/useOrg";
import styles from "./Org.module.css";

type Ctx = { org: OrgResponse; orgId: string };

const STATUS_LABEL: Record<number, string> = { "-1": "Revoked", 0: "Invited", 1: "Accepted", 2: "Confirmed" };
const TYPE_LABEL: Record<number, string> = { 0: "Owner", 1: "Admin", 2: "User", 3: "Manager" };
const STATUS_COLOR: Record<number, string> = {
  "-1": "var(--color-danger)", 0: "var(--color-warning)", 1: "var(--color-text-muted)", 2: "var(--color-success)",
};

export function OrgMembers() {
  const { orgId } = useOutletContext<Ctx>();
  const { members, loading, error, reload } = useOrgMembers(orgId);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteType, setInviteType] = useState(2); // User
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => { reload(); }, [reload]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    try {
      await inviteMembers(getApiClient(), orgId, {
        emails: [inviteEmail],
        type: inviteType,
        collections: [],
        groups: [],
      });
      setInviteEmail("");
      reload();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(member: OrgMemberResponse) {
    if (!confirm(`Remove ${member.email}?`)) return;
    try {
      await removeOrgMember(getApiClient(), orgId, member.id);
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Remove failed");
    }
  }

  return (
    <div className={styles.tabPanel}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Members</h2>
        <span className={styles.badge}>{members.length}</span>
      </div>

      <form onSubmit={handleInvite} className={styles.inviteForm}>
        <input
          className={styles.input}
          type="email"
          placeholder="colleague@example.com"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          required
        />
        <select
          className={styles.select}
          value={inviteType}
          onChange={(e) => setInviteType(Number(e.target.value))}
        >
          <option value={1}>Admin</option>
          <option value={3}>Manager</option>
          <option value={2}>User</option>
        </select>
        <button type="submit" className={styles.btnPrimary} disabled={inviting}>
          {inviting ? "Inviting…" : "Invite"}
        </button>
      </form>
      {inviteError && <p className={styles.error}>{inviteError}</p>}

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.muted}>Loading…</p>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name / Email</th>
            <th>Role</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>
                <div className={styles.memberCell}>
                  <div className={styles.avatar}>{(m.name ?? m.email)[0]?.toUpperCase()}</div>
                  <div>
                    {m.name && <div className={styles.memberName}>{m.name}</div>}
                    <div className={styles.memberEmail}>{m.email}</div>
                  </div>
                </div>
              </td>
              <td><span className={styles.roleBadge}>{TYPE_LABEL[m.type] ?? "User"}</span></td>
              <td>
                <span style={{ color: STATUS_COLOR[m.status] ?? "inherit", fontSize: "var(--font-size-xs)" }}>
                  {STATUS_LABEL[m.status] ?? "Unknown"}
                </span>
              </td>
              <td>
                {m.type !== 0 && (
                  <button className={styles.btnDanger} onClick={() => handleRemove(m)}>Remove</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
