import styles from "./Settings.module.css";
import { useAuthStore } from "../stores/auth";

export function SettingsPage() {
  const { user } = useAuthStore();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
      </header>

      <div className={styles.sections}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Account</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Email</span>
            <span className={styles.rowValue}>{user?.email}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Name</span>
            <span className={styles.rowValue}>{user?.name}</span>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Security</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>KDF algorithm</span>
            <span className={styles.rowValue}>{user?.kdfType === "argon2id" ? "Argon2id" : "PBKDF2-SHA256"}</span>
          </div>
          {user?.kdfType === "argon2id" && (
            <>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Memory (KiB)</span>
                <span className={styles.rowValue}>{user.kdfParams.mCost?.toLocaleString()}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Iterations</span>
                <span className={styles.rowValue}>{user.kdfParams.tCost}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Parallelism</span>
                <span className={styles.rowValue}>{user.kdfParams.pCost}</span>
              </div>
            </>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>About</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Version</span>
            <span className={styles.rowValue}>0.1.0</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>License</span>
            <span className={styles.rowValue}>GPL-3.0-or-later</span>
          </div>
        </section>
      </div>
    </div>
  );
}
