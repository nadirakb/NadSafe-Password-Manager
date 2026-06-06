# NadSafe Password Manager

Zero-knowledge, self-hostable password manager.  
Server = Vaultwarden (Bitwarden-compatible API). Clients = React web app + Tauri desktop + MV3 browser extension.  
Crypto core: Argon2id KDF → HKDF stretch → AES-256-CBC + HMAC-SHA256. Rust, compiled to native and WASM.

[![CI](https://github.com/nadir-akbarov/NadSafe-Password-Manager/actions/workflows/ci.yml/badge.svg)](https://github.com/nadir-akbarov/NadSafe-Password-Manager/actions/workflows/ci.yml)

---

## Quickstart — self-host in 5 minutes

**Requirements:** Docker + Docker Compose, any Linux/macOS/Windows host.

```bash
# 1. Clone
git clone https://github.com/nadir-akbarov/NadSafe-Password-Manager.git
cd NadSafe-Password-Manager

# 2. Start server (dev mode — open registration, no TLS)
docker compose up -d

# 3. Open the web vault
# Runs at http://localhost:8000 by default
# Register an account, create a vault item — done.
```

**First login in under 60 seconds.**

---

## Production deployment

```bash
# Generate a strong admin token
ADMIN_TOKEN=$(openssl rand -base64 48)

# Set your public domain (needed for WebAuthn RP ID + TLS)
DOMAIN=https://vault.example.com

# Start with Caddy reverse proxy + TLS auto-provisioning
ADMIN_TOKEN="$ADMIN_TOKEN" DOMAIN="$DOMAIN" \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Caddy auto-provisions a Let's Encrypt certificate.  
Set `SMTP_*` env vars in `docker-compose.prod.yml` to enable email verification + invitations.

### Required secrets for production

| Variable | Description |
|---|---|
| `ADMIN_TOKEN` | Admin panel password (≥ 30 chars or bcrypt hash) |
| `DOMAIN` | Full public URL (`https://vault.example.com`) |
| `SMTP_HOST` | SMTP server for email verification |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | SMTP credentials |

---

## Desktop app

```bash
# Prerequisites: Rust stable, Node 22, system Tauri deps (see below)

# Install system deps (Ubuntu/Debian)
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev

# Build web UI
npm ci && npm run build:web

# Run desktop app (dev mode)
cd clients/desktop/src-tauri
cargo tauri dev

# Build release binary
cargo tauri build
```

Binaries land in `clients/desktop/src-tauri/target/release/bundle/`.

---

## Browser extension

```bash
# Build
npm run build:ext

# Load unpacked in Chrome:
# chrome://extensions → Developer mode → Load unpacked → clients/extension/dist/
#
# Load in Firefox:
# about:debugging → This Firefox → Load Temporary Add-on → clients/extension/dist/manifest.json
```

After loading: open the web vault → Settings → Browser Extension → **Push to Extension**.  
The extension reads credentials from session storage — no master password stored in the extension.

---

## Development

```bash
# Install all deps
npm ci

# Run web vault dev server (proxies API to localhost:8000)
npm run dev:web

# Run all checks
cargo test                          # Rust (crypto core + desktop)
npm run typecheck --workspace=clients/web
npm run typecheck --workspace=clients/extension
```

### Architecture

```
NadSafe-Password-Manager/
├── crates/
│   └── crypto-core/          Rust: KDF, EncString, key hierarchy, TOTP, recovery phrase
│                             Compiles to native (desktop) + WASM (extension/web)
├── clients/
│   ├── web/                  React 19 + Vite — vault UI (shared by desktop + standalone)
│   ├── extension/            MV3 browser extension — popup, background SW, content script
│   └── desktop/              Tauri 2 — wraps web UI with native OS integration
├── caddy/                    Caddyfile for production TLS termination
├── docker-compose.yml        Dev: Vaultwarden on :8000
└── docker-compose.prod.yml   Prod: Vaultwarden + Caddy, SIGNUPS_ALLOWED=false
```

### Crypto layer

```
master_password + email
    │ Argon2id (64 MiB / 3 iter / p4) — or PBKDF2-SHA256 600k for compat
    ▼
master_key (32 bytes)
    │ HKDF-SHA256 expand (info="enc" / "mac")
    ▼
stretched_key (64 bytes = enc_key || mac_key)
    │ AES-256-CBC + HMAC-SHA256
    ▼
encrypted_user_key (EncString type 2)   ← stored on server, never plaintext

user_key (64 bytes) — encrypts all vault item fields
    │ AES-256-CBC + HMAC-SHA256 per field
    ▼
vault item EncStrings (name, username, password, url, notes, …)
```

Auth hash = `PBKDF2(master_key, master_password, 1)` — sent to server for login verification.  
Server stores only the auth hash. The server **cannot decrypt your vault.**

Recovery phrase = 32-byte CSPRNG entropy → HKDF("nadsafe-recovery-v1") → wraps user_key.  
Displayed once at registration as 8 groups of 8 hex chars.

---

## Organizations

Organizations share vault collections via asymmetric key exchange:
- Each member has an RSA-2048 key pair (private key encrypted with their user key)
- Org key (random 64-byte symmetric key) is RSA-OAEP-SHA256 encrypted to each member's public key
- Collections are encrypted with the org key — members decrypt via: private key → org key → collection items

Admin features: member management, groups, per-collection permissions (`hidePasswords`, read-only), audit log, policies (require 2FA, password strength, session timeout, disable personal export).

---

## Two-factor authentication

- **TOTP** (Google Authenticator / Authy / 1Password) — configurable via Settings → 2FA
- **WebAuthn / FIDO2** — hardware security key registration via Settings → Security Keys
- Admin policy can enforce 2FA for all org members

---

## Import / Export

**Import formats:** Bitwarden JSON, NadSafe JSON, LastPass CSV, 1Password CSV, KeePass XML, generic CSV.  
All imports are encrypted client-side before sending to the server.

**Export formats:** Bitwarden-compatible JSON (all item types), CSV (logins only).

---

## CI / CD

```
.github/workflows/ci.yml      Crypto tests, WASM build, web typecheck+build, extension build+verify, desktop cargo check
.github/workflows/release.yml Triggered on v* tags — builds Linux (deb/rpm/AppImage), macOS (dmg), Windows (msi/nsis), extension ZIPs → draft GitHub Release
```

### Release signing

Set these repository secrets for signed Tauri updater bundles:
- `TAURI_SIGNING_PRIVATE_KEY` — generated by `cargo tauri signer generate`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

For macOS notarization:
- `APPLE_ID`, `APPLE_ID_PASSWORD` (app-specific password), `APPLE_TEAM_ID`

---

## Security

See [`docs/threat-model.md`](docs/threat-model.md) for the full threat model.

**Report vulnerabilities:** open a GitHub Security Advisory (private) or email `security@nadsafe.app`.  
Do **not** open a public issue for security bugs.

**No security bugs are known at time of v0.1.0 release.** A third-party cryptographic audit is planned before v1.0.

---

## License

- Server (Vaultwarden fork): **AGPL-3.0**
- Clients (`clients/`): **GPL-3.0**
- Crypto core (`crates/`): **GPL-3.0**

The managed cloud tier (Phase 6) will be run by the NadSafe project under AGPL obligations — source is always published here.
