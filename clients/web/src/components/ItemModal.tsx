import { useState, type FormEvent } from "react";
import { getApiClient } from "../lib/api/client";
import { createCipher, updateCipher, deleteCipher } from "../lib/api/vault";
import { getSessionUserKey } from "../stores/session";
import { encryptField } from "../lib/crypto/key-hierarchy";
import { useVaultStore, type VaultItem, type ItemType } from "../stores/vault";
import { PasswordGenerator } from "./PasswordGenerator";
import styles from "./ItemModal.module.css";

const TYPE_LABELS: Record<ItemType, string> = {
  login: "🔑 Login",
  note: "📝 Secure note",
  card: "💳 Card",
  identity: "👤 Identity",
};

const TYPE_NUMBERS: Record<ItemType, number> = {
  login: 1, note: 2, card: 3, identity: 4,
};

interface Props {
  item?: VaultItem;
  onClose: () => void;
  onSaved: () => void;
}

export function ItemModal({ item, onClose, onSaved }: Props) {
  const { folders, selectItem } = useVaultStore();
  const isEdit = !!item;

  // Common
  const [type, setType] = useState<ItemType>(item?.type ?? "login");
  const [name, setName] = useState(item?.name ?? "");
  const [folderId, setFolderId] = useState(item?.folderId ?? "");
  const [favorite, setFavorite] = useState(item?.favorite ?? false);

  // Login
  const [username, setUsername] = useState(item?.login?.username ?? "");
  const [password, setPassword] = useState(item?.login?.password ?? "");
  const [url, setUrl] = useState(item?.login?.uris[0] ?? "");
  const [totpSecret, setTotpSecret] = useState(item?.login?.totp ?? "");

  // Note
  const [noteContent, setNoteContent] = useState(item?.note?.content ?? "");

  // Card
  const [cardName, setCardName] = useState(item?.card?.cardholderName ?? "");
  const [cardBrand, setCardBrand] = useState(item?.card?.brand ?? "");
  const [cardNumber, setCardNumber] = useState(item?.card?.number ?? "");
  const [cardExpMonth, setCardExpMonth] = useState(item?.card?.expMonth ?? "");
  const [cardExpYear, setCardExpYear] = useState(item?.card?.expYear ?? "");
  const [cardCode, setCardCode] = useState(item?.card?.code ?? "");

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const userKey = getSessionUserKey();
    if (!userKey) { setError("Vault is locked"); return; }

    setLoading(true);
    setError(null);
    try {
      const client = getApiClient();
      const encName = await encryptField(name, userKey);

      let loginData = null;
      let noteData = null;
      let cardData = null;

      if (type === "login") {
        const [encUser, encPass, encUrl, encTotp] = await Promise.all([
          username ? encryptField(username, userKey) : Promise.resolve(null),
          password ? encryptField(password, userKey) : Promise.resolve(null),
          url ? encryptField(url, userKey) : Promise.resolve(null),
          totpSecret ? encryptField(totpSecret, userKey) : Promise.resolve(null),
        ]);
        loginData = {
          username: encUser,
          password: encPass,
          totp: encTotp,
          uris: url ? [{ uri: encUrl!, match: null }] : [],
        };
      } else if (type === "note") {
        noteData = noteContent
          ? { type: 0 }
          : null;
      } else if (type === "card") {
        const [encCardName, encBrand, encNumber, encExp, encExpYear, encCode] = await Promise.all([
          cardName ? encryptField(cardName, userKey) : Promise.resolve(null),
          cardBrand ? encryptField(cardBrand, userKey) : Promise.resolve(null),
          cardNumber ? encryptField(cardNumber, userKey) : Promise.resolve(null),
          cardExpMonth ? encryptField(cardExpMonth, userKey) : Promise.resolve(null),
          cardExpYear ? encryptField(cardExpYear, userKey) : Promise.resolve(null),
          cardCode ? encryptField(cardCode, userKey) : Promise.resolve(null),
        ]);
        cardData = {
          cardholderName: encCardName,
          brand: encBrand,
          number: encNumber,
          expMonth: encExp,
          expYear: encExpYear,
          code: encCode,
        };
      }

      const encNotes = (type === "note" && noteContent)
        ? await encryptField(noteContent, userKey)
        : null;

      const payload = {
        type: TYPE_NUMBERS[type],
        name: encName,
        notes: encNotes,
        folderId: folderId || null,
        organizationId: null,
        collectionIds: [],
        favorite,
        reprompt: 0,
        fields: [],
        ...(loginData ? { login: loginData } : {}),
        ...(noteData ? { secureNote: noteData } : {}),
        ...(cardData ? { card: cardData } : {}),
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
            {/* Type selector — only for new items */}
            {!isEdit && (
              <div className={styles.field}>
                <label className={styles.label}>Type</label>
                <div className={styles.typeRow}>
                  {(Object.keys(TYPE_LABELS) as ItemType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={[styles.typeBtn, type === t ? styles.typeBtnActive : ""].join(" ")}
                      onClick={() => setType(t)}
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Common */}
            <div className={styles.field}>
              <label className={styles.label}>Name</label>
              <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. GitHub" required autoFocus />
            </div>

            {/* Folder */}
            {folders.length > 0 && (
              <div className={styles.field}>
                <label className={styles.label}>Folder</label>
                <select className={styles.select} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                  <option value="">No folder</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            )}

            <label className={styles.checkRow}>
              <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
              Mark as favorite
            </label>

            {/* Login fields */}
            {type === "login" && (
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
                    <input className={styles.input}
                      type={showPassword ? "text" : "password"}
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password" autoComplete="new-password"
                      style={{ fontFamily: showPassword ? "var(--font-mono)" : undefined }} />
                    <button type="button" className={styles.iconBtn} onClick={() => setShowPassword((v) => !v)}>
                      {showPassword ? "Hide" : "Show"}
                    </button>
                    <button type="button" className={styles.iconBtn} onClick={() => setShowGenerator(true)}>
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

            {/* Note fields */}
            {type === "note" && (
              <div className={styles.field}>
                <label className={styles.label}>Note content</label>
                <textarea className={styles.textarea} value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Secret note…" rows={6} />
              </div>
            )}

            {/* Card fields */}
            {type === "card" && (
              <>
                <div className={styles.field}>
                  <label className={styles.label}>Cardholder name</label>
                  <input className={styles.input} value={cardName}
                    onChange={(e) => setCardName(e.target.value)} placeholder="Jane Smith" />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Brand</label>
                  <select className={styles.select} value={cardBrand} onChange={(e) => setCardBrand(e.target.value)}>
                    <option value="">Select brand</option>
                    <option value="Visa">Visa</option>
                    <option value="Mastercard">Mastercard</option>
                    <option value="Amex">Amex</option>
                    <option value="Discover">Discover</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Card number</label>
                  <input className={styles.input} value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, "").slice(0, 19))}
                    placeholder="•••• •••• •••• ••••"
                    style={{ fontFamily: "var(--font-mono)" }} />
                </div>
                <div className={styles.twoCol}>
                  <div className={styles.field}>
                    <label className={styles.label}>Expiry month</label>
                    <input className={styles.input} value={cardExpMonth}
                      onChange={(e) => setCardExpMonth(e.target.value.replace(/\D/g, "").slice(0, 2))}
                      placeholder="MM" maxLength={2} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Expiry year</label>
                    <input className={styles.input} value={cardExpYear}
                      onChange={(e) => setCardExpYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder="YYYY" maxLength={4} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>CVV</label>
                    <input className={styles.input} type="password" value={cardCode}
                      onChange={(e) => setCardCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder="•••" maxLength={4}
                      style={{ fontFamily: "var(--font-mono)" }} />
                  </div>
                </div>
              </>
            )}

            {/* Identity fields placeholder — extended in VaultPage detail view */}
            {type === "identity" && (
              <div className={styles.field}>
                <label className={styles.label}>Notes</label>
                <textarea className={styles.textarea} value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Identity details (name, address, etc.)" rows={5} />
              </div>
            )}

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              {isEdit && (
                <button type="button" className={styles.deleteBtn}
                  onClick={handleDelete} disabled={loading}>Delete</button>
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
