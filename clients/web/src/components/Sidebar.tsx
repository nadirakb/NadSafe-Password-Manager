import { NavLink } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { useVaultStore } from "../stores/vault";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { to: "/vault", label: "All Items", icon: "⊞" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const { user, logout } = useAuthStore();
  const { folders, collections } = useVaultStore();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.logo}>NS</span>
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
          >
            <span className={styles.navIcon}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {folders.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Folders</h3>
          {folders.map((f) => (
            <button key={f.id} className={styles.navItem}>
              <span className={styles.navIcon}>📁</span>
              {f.name}
            </button>
          ))}
        </section>
      )}

      {collections.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Collections</h3>
          {collections.map((c) => (
            <button key={c.id} className={styles.navItem}>
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
        <button className={styles.logoutBtn} onClick={logout} title="Lock vault">
          🔒
        </button>
      </div>
    </aside>
  );
}
