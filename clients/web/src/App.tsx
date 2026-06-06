import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/auth";
import { getSessionUserKey } from "./stores/session";
import { useTauriAutoLock } from "./hooks/useTauriAutoLock";
import { useVaultTimeout } from "./hooks/useVaultTimeout";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { VaultPage } from "./pages/VaultPage";
import { UnlockPage } from "./pages/UnlockPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TotpSetupPage } from "./pages/TotpSetupPage";
import { RecoveryPage } from "./pages/RecoveryPhrasePage";
import { OrganizationsPage } from "./pages/OrganizationsPage";
import { ImportPage } from "./pages/ImportPage";
import { OrgDashboard } from "./pages/org/OrgDashboard";
import { OrgMembers } from "./pages/org/OrgMembers";
import { OrgGroups } from "./pages/org/OrgGroups";
import { OrgCollections } from "./pages/org/OrgCollections";
import { OrgAuditLog } from "./pages/org/OrgAuditLog";
import { OrgPolicies } from "./pages/org/OrgPolicies";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { Layout } from "./components/Layout";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLocked } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isLocked) return <Navigate to="/unlock" replace />;
  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated, isLocked, lock } = useAuthStore();

  // Lock vault when Tauri desktop window regains focus after OS sleep/lock
  useTauriAutoLock();
  // Lock vault after configurable inactivity period
  useVaultTimeout();

  useEffect(() => {
    if (isAuthenticated && !isLocked && !getSessionUserKey()) {
      lock();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/unlock" element={<UnlockPage />} />
      <Route path="/recover" element={<RecoveryPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      {/* Authenticated */}
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
        <Route path="organizations" element={<OrganizationsPage />} />
        <Route path="organizations/:orgId" element={<OrgDashboard />}>
          <Route index element={<Navigate to="members" replace />} />
          <Route path="members" element={<OrgMembers />} />
          <Route path="groups" element={<OrgGroups />} />
          <Route path="collections" element={<OrgCollections />} />
          <Route path="policies" element={<OrgPolicies />} />
          <Route path="audit" element={<OrgAuditLog />} />
        </Route>
        <Route path="import" element={<ImportPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/2fa" element={<TotpSetupPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
