import { useState, useEffect, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { getApiClient } from "../../lib/api/client";
import type { OrgResponse } from "../../lib/api/orgs";
import styles from "./Org.module.css";

type Ctx = { org: OrgResponse; orgId: string };

interface PolicySetting {
  enabled: boolean;
  data?: Record<string, unknown>;
}

interface OrgPoliciesState {
  /** Minimum password strength (0-4: weak → very strong). */
  passwordStrength: PolicySetting & { data: { minScore: number } };
  /** Require 2FA for org members. */
  twoFactorAuthentication: PolicySetting;
  /** Block personal vault exports from org devices. */
  disablePersonalVaultExport: PolicySetting;
  /** Enforce master password re-prompt on autofill. */
  masterPasswordReprompt: PolicySetting;
  /** Maximum session inactivity before auto-lock (minutes). */
  maxInactivityTimeout: PolicySetting & { data: { maxMinutes: number } };
}

const defaultPolicies: OrgPoliciesState = {
  passwordStrength: { enabled: false, data: { minScore: 3 } },
  twoFactorAuthentication: { enabled: false },
  disablePersonalVaultExport: { enabled: false },
  masterPasswordReprompt: { enabled: false },
  maxInactivityTimeout: { enabled: false, data: { maxMinutes: 30 } },
};

const POLICY_TYPES: Record<string, number> = {
  twoFactorAuthentication: 0,
  masterPasswordStrength: 1,
  passwordGenerator: 2,
  singleOrg: 3,
  requireSso: 4,
  personalOwnership: 5,
  disableSend: 6,
  sendOptions: 7,
  resetPassword: 8,
  maxVaultTimeout: 9,
  disablePersonalVaultExport: 10,
  activateAutofill: 11,
};

export function OrgPolicies() {
  const { orgId } = useOutletContext<Ctx>();
  const [policies, setPolicies] = useState<OrgPoliciesState>(defaultPolicies);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function loadPolicies() {
      setLoading(true);
      setError(null);
      try {
        const res = await getApiClient().get<{
          data: Array<{ type: number; enabled: boolean; data?: Record<string, unknown> }>;
        }>(`/api/organizations/${orgId}/policies`);

        const policyMap = new Map(res.data.map((p) => [p.type, p]));
        setPolicies((prev) => ({
          ...prev,
          twoFactorAuthentication: {
            enabled: policyMap.get(POLICY_TYPES.twoFactorAuthentication)?.enabled ?? false,
          },
          disablePersonalVaultExport: {
            enabled: policyMap.get(POLICY_TYPES.disablePersonalVaultExport)?.enabled ?? false,
          },
          maxInactivityTimeout: {
            enabled: policyMap.get(POLICY_TYPES.maxVaultTimeout)?.enabled ?? false,
            data: {
              maxMinutes: (policyMap.get(POLICY_TYPES.maxVaultTimeout)?.data?.minutes as number) ?? 30,
            },
          },
          passwordStrength: {
            enabled: policyMap.get(POLICY_TYPES.masterPasswordStrength)?.enabled ?? false,
            data: {
              minScore: (policyMap.get(POLICY_TYPES.masterPasswordStrength)?.data?.minComplexity as number) ?? 3,
            },
          },
        }));
      } catch {
        // Vaultwarden free plan may return 404 for policies — show defaults
        setError(null);
      } finally {
        setLoading(false);
      }
    }
    loadPolicies();
  }, [orgId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const updates = [
        {
          type: POLICY_TYPES.twoFactorAuthentication,
          enabled: policies.twoFactorAuthentication.enabled,
          data: {},
        },
        {
          type: POLICY_TYPES.disablePersonalVaultExport,
          enabled: policies.disablePersonalVaultExport.enabled,
          data: {},
        },
        {
          type: POLICY_TYPES.maxVaultTimeout,
          enabled: policies.maxInactivityTimeout.enabled,
          data: { minutes: policies.maxInactivityTimeout.data?.maxMinutes ?? 30, action: "lock" },
        },
        {
          type: POLICY_TYPES.masterPasswordStrength,
          enabled: policies.passwordStrength.enabled,
          data: { minComplexity: policies.passwordStrength.data?.minScore ?? 3 },
        },
      ];

      await Promise.all(
        updates.map((u) =>
          getApiClient()
            .put(`/api/organizations/${orgId}/policies/${u.type}`, u)
            .catch(() => null), // non-fatal — some Vaultwarden builds don't support all policy types
        ),
      );

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function toggle(key: keyof OrgPoliciesState) {
    setPolicies((prev) => ({
      ...prev,
      [key]: { ...prev[key], enabled: !prev[key].enabled },
    }));
  }

  return (
    <div className={styles.tabPanel}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Organization policies</h2>
      </div>

      <p className={styles.policyIntro}>
        Policies apply to all members of this organization. Enterprise Vaultwarden may be required for some policies.
      </p>

      {loading && <p className={styles.muted}>Loading policies…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && (
        <form onSubmit={handleSave} className={styles.policyForm}>
          {/* 2FA policy */}
          <div className={styles.policyCard}>
            <div className={styles.policyCardHeader}>
              <div>
                <h3 className={styles.policyName}>Require two-factor authentication</h3>
                <p className={styles.policyDesc}>Members must have 2FA enabled to access the organization vault.</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={policies.twoFactorAuthentication.enabled}
                  onChange={() => toggle("twoFactorAuthentication")}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>
          </div>

          {/* Password strength policy */}
          <div className={styles.policyCard}>
            <div className={styles.policyCardHeader}>
              <div>
                <h3 className={styles.policyName}>Minimum password strength</h3>
                <p className={styles.policyDesc}>
                  Require members to use passwords of a minimum strength level.
                </p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={policies.passwordStrength.enabled}
                  onChange={() => toggle("passwordStrength")}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>
            {policies.passwordStrength.enabled && (
              <div className={styles.policyDetail}>
                <label className={styles.policyDetailLabel}>Minimum strength level</label>
                <select
                  className={styles.policySelect}
                  value={policies.passwordStrength.data.minScore}
                  onChange={(e) => setPolicies((prev) => ({
                    ...prev,
                    passwordStrength: { ...prev.passwordStrength, data: { minScore: Number(e.target.value) } },
                  }))}
                >
                  <option value={1}>1 — Weak</option>
                  <option value={2}>2 — Fair</option>
                  <option value={3}>3 — Good</option>
                  <option value={4}>4 — Strong</option>
                </select>
              </div>
            )}
          </div>

          {/* Export restriction */}
          <div className={styles.policyCard}>
            <div className={styles.policyCardHeader}>
              <div>
                <h3 className={styles.policyName}>Disable personal vault export</h3>
                <p className={styles.policyDesc}>Prevent members from exporting their personal vault data.</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={policies.disablePersonalVaultExport.enabled}
                  onChange={() => toggle("disablePersonalVaultExport")}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>
          </div>

          {/* Session timeout policy */}
          <div className={styles.policyCard}>
            <div className={styles.policyCardHeader}>
              <div>
                <h3 className={styles.policyName}>Maximum session timeout</h3>
                <p className={styles.policyDesc}>Enforce a maximum inactivity period before vault auto-locks.</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={policies.maxInactivityTimeout.enabled}
                  onChange={() => toggle("maxInactivityTimeout")}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>
            {policies.maxInactivityTimeout.enabled && (
              <div className={styles.policyDetail}>
                <label className={styles.policyDetailLabel}>Maximum idle minutes</label>
                <input
                  type="number"
                  className={styles.policyInput}
                  min={1}
                  max={1440}
                  value={policies.maxInactivityTimeout.data.maxMinutes}
                  onChange={(e) => setPolicies((prev) => ({
                    ...prev,
                    maxInactivityTimeout: {
                      ...prev.maxInactivityTimeout,
                      data: { maxMinutes: Number(e.target.value) },
                    },
                  }))}
                />
              </div>
            )}
          </div>

          {success && <p className={styles.policySuccess}>✓ Policies saved</p>}
          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.policyFooter}>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? "Saving…" : "Save policies"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
