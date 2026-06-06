/**
 * Accept organization invitation.
 * URL: /accept-invite?orgId=...&orgName=...&email=...&token=...
 *
 * Vaultwarden endpoint: POST /api/organizations/:orgId/users/:invitationToken/accept
 * with { token: string }
 */

import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { getApiClient } from "../lib/api/client";
import { useAuthStore } from "../stores/auth";
import styles from "./Auth.module.css";

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();

  const orgId = params.get("organizationId") ?? params.get("orgId") ?? "";
  const orgName = params.get("organizationName") ?? params.get("orgName") ?? "an organization";
  const token = params.get("token") ?? "";
  const email = params.get("email") ?? "";

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Auto-accept if already authenticated
  useEffect(() => {
    if (isAuthenticated && orgId && token) {
      handleAccept();
    }
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAccept() {
    if (!orgId || !token) {
      setError("Invalid invitation link — missing organization ID or token");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError(null);
    try {
      // Vaultwarden: POST /api/organizations/:orgId/users/:token/accept
      await getApiClient().post(`/api/organizations/${orgId}/users/${token}/accept`, {
        token,
      });
      setStatus("success");
      setTimeout(() => navigate(`/organizations/${orgId}/members`), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invitation");
      setStatus("error");
    }
  }

  if (!isAuthenticated) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.header}>
            <span className={styles.logo}>NS</span>
            <h1 className={styles.title}>Organization invitation</h1>
          </div>
          <p className={styles.hint}>
            You have been invited to join <strong>{orgName}</strong>.
            {email && ` This invitation was sent to ${email}.`}
          </p>
          <p className={styles.hint}>
            Sign in to accept the invitation.
          </p>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <Link
              to={`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`}
              className={styles.submitBtn}
              style={{ textAlign: "center", textDecoration: "none" }}
            >
              Sign in
            </Link>
            <Link
              to={`/register?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`}
              className={styles.submitBtn}
              style={{ textAlign: "center", textDecoration: "none", background: "var(--color-bg-surface)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.logo}>NS</span>
          <h1 className={styles.title}>Accept invitation</h1>
        </div>

        {status === "idle" && (
          <>
            <p className={styles.hint}>
              Join <strong>{orgName}</strong>{email ? ` as ${email}` : ""}.
            </p>
            <button className={styles.submitBtn} onClick={handleAccept}>
              Accept invitation
            </button>
          </>
        )}

        {status === "loading" && (
          <p className={styles.hint}>Accepting invitation…</p>
        )}

        {status === "success" && (
          <>
            <p className={styles.hint} style={{ color: "#22c55e" }}>
              ✓ Successfully joined <strong>{orgName}</strong>! Redirecting…
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <p className={styles.error}>{error}</p>
            <p className={styles.hint}>
              The invitation may have expired or already been accepted.{" "}
              <Link to="/organizations">Go to organizations</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
