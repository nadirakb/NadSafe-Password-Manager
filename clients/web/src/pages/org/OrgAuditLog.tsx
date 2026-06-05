import { useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { useOrgEvents } from "../../hooks/useOrg";
import type { OrgResponse } from "../../lib/api/orgs";
import styles from "./Org.module.css";

type Ctx = { org: OrgResponse; orgId: string };

// Bitwarden event type codes → human labels (subset)
const EVENT_LABELS: Record<number, string> = {
  1000: "User logged in",
  1001: "User changed master password",
  1002: "User updated 2FA",
  1004: "User deleted account",
  1005: "User recovered account",
  1006: "User exported vault",
  1007: "User updated profile",
  1100: "Item created",
  1101: "Item updated",
  1102: "Item deleted",
  1103: "Item permanently deleted",
  1104: "Item restored",
  1107: "Item copied",
  1300: "Collection created",
  1301: "Collection updated",
  1302: "Collection deleted",
  1400: "Org updated",
  1500: "Org policy updated",
  1600: "Group created",
  1601: "Group updated",
  1602: "Group deleted",
  1700: "Member invited",
  1701: "Member confirmed",
  1703: "Member removed",
  1704: "Member updated",
  1706: "Member accepted invitation",
};

export function OrgAuditLog() {
  const { orgId } = useOutletContext<Ctx>();
  const { events, loading, error, reload } = useOrgEvents(orgId);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className={styles.tabPanel}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Audit Log</h2>
        <button className={styles.btnSecondary} onClick={reload}>↻ Refresh</button>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.muted}>Loading…</p>}

      {events.length === 0 && !loading && (
        <div className={styles.emptyState}>
          <p>No events recorded yet. Actions by org members appear here.</p>
        </div>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Event</th>
            <th>Actor</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td className={styles.mono}>{new Date(e.date).toLocaleString()}</td>
              <td>{EVENT_LABELS[e.type] ?? `Event ${e.type}`}</td>
              <td className={styles.muted}>{e.actingUserId?.slice(0, 8) ?? "—"}</td>
              <td className={styles.muted}>{e.ipAddress ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
