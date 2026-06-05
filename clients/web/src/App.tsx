import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/auth";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { VaultPage } from "./pages/VaultPage";
import { UnlockPage } from "./pages/UnlockPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Layout } from "./components/Layout";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLocked } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isLocked) return <Navigate to="/unlock" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/unlock" element={<UnlockPage />} />
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
