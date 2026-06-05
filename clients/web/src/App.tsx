import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/auth";
import { getSessionUserKey } from "./stores/session";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { VaultPage } from "./pages/VaultPage";
import { UnlockPage } from "./pages/UnlockPage";
import { SettingsPage } from "./pages/SettingsPage";
import { RecoveryPage } from "./pages/RecoveryPhrasePage";
import { Layout } from "./components/Layout";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLocked } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isLocked) return <Navigate to="/unlock" replace />;
  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated, isLocked, lock } = useAuthStore();

  // On every mount/reload: if authenticated but session key is gone (page reload
  // wiped in-memory key), lock the vault so the user is sent to /unlock.
  useEffect(() => {
    if (isAuthenticated && !isLocked && !getSessionUserKey()) {
      lock();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/unlock" element={<UnlockPage />} />
      <Route path="/recover" element={<RecoveryPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/vault" replace />} />
        <Route path="vault" element={<VaultPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
