import { useState, useEffect } from "react";
import { useParams, NavLink, Outlet, useNavigate } from "react-router-dom";
import { getApiClient } from "../../lib/api/client";
import { getOrg, type OrgResponse } from "../../lib/api/orgs";
import styles from "./Org.module.css";

const ORG_TABS = [
  { path: "members", label: "Members", icon: "👥" },
  { path: "groups", label: "Groups", icon: "🏷" },
  { path: "collections", label: "Collections", icon: "📂" },
  { path: "policies", label: "Policies", icon: "🛡" },
  { path: "audit", label: "Audit Log", icon: "📋" },
];

export function OrgDashboard() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [org, setOrg] = useState<OrgResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    getOrg(getApiClient(), orgId)
      .then(setOrg)
      .catch(() => navigate("/organizations"))
      .finally(() => setLoading(false));
  }, [orgId, navigate]);

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (!org) return null;

  const roleLabels = ["Owner", "Admin", "User", "Manager"];

  return (
    <div className={styles.dashboard}>
      <header className={styles.orgHeader}>
        <div className={styles.orgMeta}>
          <div className={styles.orgAvatar}>{org.name[0]?.toUpperCase()}</div>
          <div>
            <h1 className={styles.orgName}>{org.name}</h1>
            <span className={styles.orgRole}>{roleLabels[org.type] ?? "Member"}</span>
          </div>
        </div>
      </header>

      <nav className={styles.tabs}>
        {ORG_TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={`/organizations/${orgId}/${tab.path}`}
            className={({ isActive }) => [styles.tab, isActive ? styles.tabActive : ""].join(" ")}
          >
            <span>{tab.icon}</span> {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className={styles.tabContent}>
        <Outlet context={{ org, orgId: orgId! }} />
      </div>
    </div>
  );
}
