# NadSafe Threat Model

**Version:** 0.1 — Phase 0/1 draft  
**Last updated:** 2026-06-06  
**Status:** Published; scheduled for third-party review pre-1.0

---

## 1. Scope

This document covers the cryptographic and operational security properties of:

- NadSafe crypto core (Rust, compiled to native + WASM)
- NadSafe web vault (React, browser context)
- NadSafe desktop app (Tauri 2, wraps web vault with native IPC)
- NadSafe browser extension (MV3, background service worker + content script)
- NadSafe server (Vaultwarden fork, REST API)
- Self-hosted deployment (Docker + Caddy)

**Out of scope for this version:** managed cloud infrastructure (Phase 6), mobile (Phase 7), SCIM/directory sync.

---

## 2. Principals and Trust Levels

| Principal | Trusted for | Not trusted for |
|---|---|---|
| **User** | Knows master password; controls registered devices | Nothing additional |
| **Server** | Storing encrypted blobs, enforcing access tokens, org membership | Seeing plaintext vault data |
| **Browser extension** | Running in extension context; access to page DOM | Storing master password or user key between sessions |
| **Tauri backend (Rust)** | Running native code on user's OS | Anything requiring zero-trust — runs with OS user privileges |
| **Org admin** | Org-level key operations (inviting, revoking members) | Individual member vault data outside org collections |
| **Operator (self-hoster)** | Server config, data-at-rest access on the host FS | Decrypting vault items (keys never reach server in plaintext) |

---

## 3. Cryptographic Design

### 3.1 Key Hierarchy

```
master_password + email (lowercased)
       │
       │ KDF (Argon2id: 64 MiB / 3t / p4 — or PBKDF2-SHA256 600k for compat)
       ▼
  master_key (32 bytes, zeroized on lock)
       │
       │ HKDF-SHA256 expand (info="enc")  →  enc_key (32 bytes)
       │ HKDF-SHA256 expand (info="mac")  →  mac_key (32 bytes)
       │ (master_key treated as HKDF PRK — no salt phase, Bitwarden-compatible)
       ▼
  stretched_key (64 bytes = enc_key ‖ mac_key)
       │
       │ AES-256-CBC encrypt (random 16-byte IV)
       │ HMAC-SHA256 authenticate (IV ‖ ciphertext)
       ▼
  encrypted_user_key (EncString "2.{iv}|{ct}|{mac}")   ← stored on server
       │
       │ (decrypt on client after successful login)
       ▼
  user_key (64 bytes = enc_key ‖ mac_key)
       │
       │ AES-256-CBC + HMAC-SHA256 per field
       ▼
  vault item EncStrings (name, username, password, url, notes, …)
```

**Auth hash** = `PBKDF2(master_key, master_password, 1)` — sent to server at login.  
The server stores only this hash. It cannot reconstruct master_key or user_key.

**Property:** A fully compromised server (DB dump) reveals only encrypted blobs. Decryption requires master_password, which never leaves the client.

### 3.2 EncString Format

Format: `2.{base64(IV)}|{base64(ciphertext)}|{base64(MAC)}`  
- Type `2` = AES-256-CBC + HMAC-SHA256 (encrypt-then-MAC)
- IV: 16 random bytes per encryption
- MAC covers `IV ‖ ciphertext` (not plaintext)
- MAC verification uses constant-time XOR comparison
- Bitwarden wire-compatible — official clients can decrypt NadSafe vaults

### 3.3 Argon2id Parameters

Default: `m=65536` (64 MiB), `t=3`, `p=4`.  
These meet OWASP minimum recommendations for interactive logins.  
Admins should increase `m` on servers with sufficient RAM.

**Rationale for Argon2id over PBKDF2:** memory-hard, GPU/ASIC-resistant. Bitwarden migrated to Argon2id as their new default; we adopt it as our default while maintaining PBKDF2 compat for import/migration.

### 3.4 Organization Key Exchange

```
Org owner generates org_key (64 random bytes)
        │
        │ RSA-OAEP-SHA256 encrypt to each member's public key
        ▼
encrypted_org_key  ← stored on server per member

Member login:
  user_key  →  decrypt RSA private key  →  decrypt org_key  →  decrypt collection items
```

- RSA key size: 2048 bits (minimum; 4096 preferred for long-lived org keys)
- OAEP padding with SHA-256 (not PKCS#1v1.5 — not vulnerable to Bleichenbacher)

### 3.5 Recovery Phrase

```
entropy = CSPRNG(32 bytes)
        │
        │ HKDF-SHA256 (PRK=entropy, info="nadsafe-recovery-v1")
        │ T(1) → enc_key (32 bytes)
        │ T(2) → mac_key (32 bytes)
        ▼
recovery_key (64 bytes)
        │
        │ AES-256-CBC + HMAC-SHA256
        ▼
encrypted_user_key  ← stored on server alongside master-password-wrapped key
```

Displayed once at registration as 8 groups of 8 hex chars. No server-side recovery without this phrase.  
**User must store phrase offline.** Loss of both master password and recovery phrase = permanent vault loss (by design — zero-knowledge).

---

## 4. Threat Model

### 4.1 Server Compromise (DB dump or RCE)

**Attacker gains:** encrypted vault blobs, auth hashes, public keys, encrypted user keys, encrypted org keys.

**Attacker cannot do:**
- Decrypt any vault item (needs master_password or recovery phrase)
- Log in as a user (auth hash ≠ master_password; PBKDF2 with 1 iteration is weak, but master_key is not accessible)

**Mitigations:**
- Auth hash is single-round PBKDF2 — if server is compromised, offline dictionary attacks on weak master passwords are feasible. **Mitigation: enforce minimum password strength in org policies; Argon2id KDF makes dictionary attacks expensive.**
- Encrypted user_key stored on server — if auth hash is cracked offline + user key decryption is attempted: attacker needs stretched_key derived from master_key derived from master_password. Argon2id makes this expensive.
- **Admin recommendation:** enable FDE on the server host; restrict server access to VPN; rotate ADMIN_TOKEN regularly.

### 4.2 Network / TLS Interception (MITM)

**Attacker gains:** auth hash (if TLS stripped), encrypted API responses.

**Mitigations:**
- HSTS header in Caddy config (`max-age=31536000; includeSubDomains; preload`)
- Auth hash ≠ master_password — MITM of login doesn't directly reveal vault key
- Server must be accessed over HTTPS in production — Caddy enforces this
- **Admin recommendation:** pin certificate; use HSTS preload; deploy behind Cloudflare or equivalent for DDoS protection

### 4.3 Malicious Extension (Supply-Chain Attack)

**Attacker scenario:** compromised extension build or npm package.

**Mitigations:**
- Extension only receives pre-decrypted items via `STORE_ITEMS` message from web app (user-initiated push)
- Extension stores items in `chrome.storage.session` — ephemeral, cleared on browser restart
- Extension never has master_password or master_key
- Extension communicates with web app via `window.postMessage` with origin check (`source: "nadsafe-webapp"`)
- Build is reproducible; lockfiles pinned; `npm ci` used in CI
- **Residual risk:** compromised extension can exfiltrate pushed vault items (plaintext passwords stored in session). Mitigation: push only on demand, not automatically.

### 4.4 Compromised Client Device (Malware / Physical Access)

**Attacker gains:** access to OS user account where NadSafe is running.

**Impact:**
- Locked vault: no data exposed (user_key not in memory)
- Unlocked vault: user_key in JS heap; items visible in process memory; OS process dump reveals plaintext

**Mitigations:**
- Auto-lock on Tauri desktop: `vault:focus-restored` event on OS re-focus after sleep/lock; configurable timeout
- Session keys stored in JS `let` (module scope) — not `localStorage`, not `sessionStorage`, not `IndexedDB`
- Recovery phrase displayed once then discarded — not stored in app state
- **Residual risk:** sophisticated OS-level attacker with process memory read access cannot be mitigated at the app layer. FDE + strong OS account password required.

### 4.5 Phishing / Credential Stuffing

**Mitigations:**
- WebAuthn (FIDO2) second factor: phishing-resistant by origin binding
- TOTP second factor: not phishing-resistant but raises the bar
- Rate limiting on `/api/accounts/login` (Caddy + `IP_HEADER` config in prod)
- Account lockout after N failed attempts (Vaultwarden built-in)

### 4.6 Weak Master Password

**Risk:** offline dictionary attack on captured auth hash.

**Mitigations:**
- Argon2id KDF: GPU dictionary attack costs ~$1000/month per 10M guesses at 64 MiB — strong passwords are effectively uncrackable
- Org admin policy: enforce minimum password strength (`masterPasswordStrength` policy type 1)
- UI shows zxcvbn strength meter during registration/change
- **Admin recommendation:** require ≥ 5-word diceware passphrase for all org accounts

### 4.7 Key Commitment / Invisible Salamander

**Concern:** AES-CBC + HMAC-SHA256 (encrypt-then-MAC) without key commitment allows "invisible salamander" attack where same ciphertext decrypts differently under two different keys.

**Assessment:** In NadSafe's threat model this is not exploitable — an attacker controlling server cannot produce a ciphertext that decrypts validly under two different keys _and_ passes HMAC verification with both keys simultaneously, without also knowing one of the keys. The attack requires a key oracle, which the server doesn't have. **Bitwarden uses the same scheme.** Committed encryption (HMAC-based key commitment) is under active discussion in Bitwarden's security track; we will track and adopt when Bitwarden SDK does.

### 4.8 Side-Channel Attacks

- MAC comparison uses constant-time XOR (`diff |= x ^ y`) — not `==` — preventing timing oracle
- Argon2id output is fixed-length — no padding oracle
- **Residual risk:** browser JS timing attacks against crypto operations are possible in theory; mitigated by `crossOriginIsolated` if operator enables COOP/COEP headers (not enabled by default to preserve WebAuthn compat)

---

## 5. Data at Rest

| Location | What's stored | Encrypted by |
|---|---|---|
| Server database | EncStrings (vault items, user key, org keys), auth hash, public keys | User key (client-side), or RSA pub key |
| Server filesystem | Vaultwarden data dir (`/data`) | Host OS FDE (operator responsibility) |
| Browser `chrome.storage.session` | Pre-decrypted vault items (extension session only) | Extension process sandbox |
| Tauri app memory | user_key (unlocked state), RSA private key | Cleared on lock / app exit |
| Recovery phrase | User's offline backup | Physical security (user responsibility) |

**Nothing sensitive stored in `localStorage`, cookies, or any persistent browser storage.**

---

## 6. Data in Transit

- All API traffic: HTTPS (Caddy terminates TLS; Vaultwarden plain HTTP inside Docker network)
- WebSocket (live sync): WSS
- Extension ↔ background SW: `chrome.runtime.sendMessage` (extension IPC, sandboxed)
- Web app ↔ extension: `window.postMessage` with `source` origin check

---

## 7. Known Limitations and Accepted Risks

| Risk | Severity | Accepted? | Notes |
|---|---|---|---|
| Argon2id 64 MiB may be too slow on very old hardware | Low | Yes | Configurable; PBKDF2 fallback available |
| RSA-2048 (org keys) will eventually need rotation to 3072/4096 | Low–Med | Yes | Planned post-1.0; 2048 safe until ~2030 per NIST |
| JS process memory dump reveals user_key on unlocked device | High (physical attacker) | Accepted — inherent to browser apps | FDE + OS account security required |
| Extension session storage exposed to extension process | Med | Accepted | Push is user-initiated; session is ephemeral |
| Auth hash is PBKDF2(1) — weak standalone | Med | Accepted | Full KDF is applied client-side; server hash is a secondary defense layer |
| No key commitment in EncString | Low (in our threat model) | Accepted | Tracking Bitwarden SDK for adoption |
| WebAuthn RP ID tied to domain — self-hosters must set DOMAIN correctly | Med (misconfiguration) | Documented | docker-compose.prod.yml enforces DOMAIN env |

---

## 8. Out of Scope for v1.0

- Quantum-resistant algorithms (post-quantum KEM for org key exchange) — planned for post-1.0
- Biometric unlock / OS keychain integration — fast-follow per platform
- Emergency access (trusted contact recovery) — post-1.0
- SCIM / directory sync — post-1.0
- Client-side audit (detecting server-served malicious JS) — requires subresource integrity + reproducible builds audit (planned for v1.0 release)

---

## 9. Audit Status

- **Internal review:** code review by project authors (ongoing)
- **Conformance tests:** 17 automated tests against PBKDF2 / HKDF / EncString reference vectors (see `crates/crypto-core/tests/bitwarden_vectors.rs`)
- **Third-party audit:** planned before v1.0 release — focus on crypto layer + key exchange
- **Bug bounty:** to be launched at v1.0

---

## 10. References

- [Bitwarden Security Whitepaper](https://bitwarden.com/help/bitwarden-security-white-paper/)
- [Argon2 RFC 9106](https://www.rfc-editor.org/rfc/rfc9106)
- [HKDF RFC 5869](https://www.rfc-editor.org/rfc/rfc5869)
- [WebAuthn Level 2](https://www.w3.org/TR/webauthn-2/)
- [Vaultwarden](https://github.com/dani-garcia/vaultwarden)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
