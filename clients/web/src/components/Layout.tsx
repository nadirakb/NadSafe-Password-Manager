import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useExtensionAutoPush } from "../hooks/useExtensionAutoPush";
import styles from "./Layout.module.css";

export function Layout() {
  // Keep the browser extension unlocked in step with the web app.
  useExtensionAutoPush();

  return (
    <div className={styles.layout}>
      <Sidebar />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
