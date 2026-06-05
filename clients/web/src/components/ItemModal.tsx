import { useState, type FormEvent } from "react";
import { getApiClient } from "../lib/api/client";
import { createCipher, updateCipher, deleteCipher } from "../lib/api/vault";
import { getSessionUserKey } from "../stores/session";
import { encryptField } from "../lib/crypto/key-hierarchy";
import { useVaultStore, type VaultItem } from "../stores/vault";
import { PasswordGenerator } from "./PasswordGenerator";
import styles from "./ItemModal.module.css";

interface Props {
  item?: VaultItem;
  onClose: () => void;
  onSaved: () => void;
}

export function ItemModal({ item, onClose, onSaved }: Props) {
  const [name, setName] = useState(item?.name ?? "");
  const [username, setUsername] = useState(item?.login?.username ?? "");
  const [password, setPassword] = useState(item?.login?.password ?? "");
  const [url, setUrl] = useState(item?.login?.uris[0] ?? "");
  const [totpSecret, setTotpSecret] = useState(item?.login?.totp ?? "");
  const [notes, setNotes] = useState(item?.note?.content ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { selectItem } = useVaultStore();

  const isEdit = !!item;
  const type = item?.type ?? "login";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const userKey = getSessionUserKey();
    if (!userKey) { setError("Vault is locked"); return; }

    setLoading(true);
    setError(null);
    try {
      const client = getApiClient();
      const [encName, encUsername, encPassword, encUrl, encTotp, encNotes] = await Promise.all([
        encryptField(name, userKey),
        username ? encryptField(username, userKey) : Promise.resolve(null),
        password ? encryptField(password, userKey) : Promise.resolve(null),
        url ? encryptField(url, userKey) : Promise.resolve(null),
        totpSecret ? encryptField(totpSecret, userKey) : Promise.resolve(null),
        notes ? encryptField(notes, userKey) : Promise.resolve(null),
      ]);

      const payload = {
        type: 1, // login
        name: encName,
        notes: encNotes,
        folderId: null,
        organizationId: null,
        collectionIds: [],
        favorite: item?.favorite ?? false,
        reprompt: 0,
        fields: [],
        login: {
          username: encUsername,
          password: encPassword,
          totp: encTotp,
          uris: url ? [{ uri: encUrl!, match: null }] : [],
        },
      };

      if (isEdit) {
        await updateCipher(client, item.id, payload);
      } else {
        await createCipher(client, payload);
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!item || !confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    setLoading(true);
    try {
      await deleteCipher(getApiClient(), item.id);
      selectItem(null);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h2 className={styles.title}>{isEdit ? "Edit item" : "Add item"}</h2>
            <button className={styles.closeBtn} onClick={onClose}>✕</button>
          </div>

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label}>Name</label>
              <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. GitHub" required autoFocus />
            </div>

            {(type === "login" || !item) && (
              <>
                <div className={styles.field}>
                  <label className={styles.label}>Username / Email</label>
                  <input className={styles.input} value={username}
                    onChange={(e) => setUsername(e.target.value)} placeholder="you@example.com"
                    autoComplete="off" />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Password</label>
                  <div className={styles.passwordRow}>
                    <input
                      className={styles.input}
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      autoComplete="new-password"
                      style={{ fontFamily: showPassword ? "var(--font-mono)" : undefined }}
                    />
                    <button type="button" className={styles.iconBtn}
                      onClick={() => setShowPassword((v) => !v)}>
                      {showPassword ? "Hide" : "Show"}
                    </button>
                    <button type="button" className={styles.iconBtn}
                      onClick={() => setShowGenerator(true)}>
                      ⚙ Gen
                    </button>
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>URL</label>
                  <input className={styles.input} type="url" value={url}
                    onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>TOTP secret (base32)</label>
                  <input className={styles.input} value={totpSecret}
                    onChange={(e) => setTotpSecret(e.target.value)}
                    placeholder="JBSWY3DPEHPK3PXP" autoComplete="off"
                    style={{ fontFamily: "var(--font-mono)" }} />
                </div>
              </>
            )}

            <div className={styles.field}>
              <label className={styles.label}>Notes</label>
              <textarea className={styles.textarea} value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes…" rows={3} />
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              {isEdit && (
                <button type="button" className={styles.deleteBtn}
                  onClick={handleDelete} disabled={loading}>
                  Delete
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
              <button type="submit" className={styles.saveBtn} disabled={loading}>
                {loading ? "Saving…" : isEdit ? "Save" : "Add item"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showGenerator && (
        <PasswordGenerator
          onSelect={(pw) => setPassword(pw)}
          onClose={() => setShowGenerator(false)}
        />
      )}
    </>
  );
}
