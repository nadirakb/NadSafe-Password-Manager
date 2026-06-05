# PRD — NadSafe Password Manager

| | |
|---|---|
| **Status** | Draft v0.2 — §15 decisions incorporated; awaiting final sign-off |
| **Author** | Nadir |
| **Last updated** | 2026-06-05 |
| **Type** | Open-source, multiplatform, corporate password manager |
| **License (proposed)** | AGPL-3.0 (server) / GPL-3.0 (clients) — see §11 |

---

## 1. Summary

NadSafe is a free, open-source, end-to-end-encrypted (zero-knowledge) password manager for organizations. It targets Windows, Linux, and macOS desktops plus a browser extension at v1, with Android and iOS to follow. The backend is a fork of [Vaultwarden](https://github.com/dani-garcia/vaultwarden) (a Rust server that implements the Bitwarden Client API), and the clients are new Tauri (Rust + web UI) applications that speak the same protocol. NadSafe can be self-hosted by any organization or consumed via an optional managed-cloud tier.

The product's two pillars are **(1) the highest practical level of security** — client-side encryption, modern KDFs, no plaintext ever reaching the server — and **(2) fine-grained access control** — users grouped into teams/collections so that each group only sees the secrets it is entitled to.

---

## 2. Problem statement

Organizations need to share credentials (server logins, SaaS accounts, API keys, Wi-Fi passwords, recovery codes) across teams without emailing them, pasting them in chat, or storing them in spreadsheets. Commercial password managers solve this but: (a) lock the org into a vendor and recurring per-seat pricing; (b) are often closed-source, so the security model can't be independently audited; (c) self-hosting is either unavailable or gated behind enterprise tiers.

Existing OSS options have gaps. Vaultwarden is an excellent server but ships no first-party clients of its own — it relies on official Bitwarden clients, which means a NadSafe-branded, NadSafe-controlled client experience doesn't exist, and the org's UX/roadmap is tied to Bitwarden's decisions (and Bitwarden's evolving licensing — see §11). NadSafe closes that gap: a fully open, self-hostable server **and** a coherent set of first-party clients under one project.

**Why now:** Bitwarden's Oct 2024 SDK-licensing episode (resolved by relicensing the client SDK to GPLv3, while `sdk-secrets` stays proprietary) showed how fragile a community's trust is when clients depend on a vendor-controlled component. A clean-room, copyleft client stack removes that dependency entirely.

---

## 3. Goals & non-goals

### 3.1 Goals

1. **Zero-knowledge security.** The server never has access to plaintext vault data or the keys to decrypt it. All encryption/decryption happens on the client.
2. **Group-based access control.** Admins can define groups of users and grant each group access to specific collections of secrets, with per-collection read / write / manage permissions.
3. **True multiplatform reach.** One shared core powers desktop (Win/Linux/macOS) and the browser extension at v1; mobile reuses the same crypto/protocol layer later.
4. **Self-hostable in minutes.** A single binary or one `docker compose up` stands up a working server. No external dependencies required for a basic deployment.
5. **Optional managed cloud.** Organizations that don't want to run infrastructure can use a hosted tier with the identical zero-knowledge guarantees.
6. **Fully open source & auditable.** Every component the client runs is OSI-licensed; the crypto is documented and reproducible.
7. **Interoperability as a safety net.** Because the server keeps the Bitwarden API contract, official Bitwarden clients remain usable as a fallback/migration aid (license permitting — see §11).

### 3.2 Non-goals (v1)

- Not building a consumer/individual freemium product or a Bitwarden-style marketing funnel.
- Not a Secrets Manager / machine-to-machine secrets platform (CI/CD injection, dynamic secrets) — explicitly out of v1 scope; revisit post-1.0.
- Not implementing passkey *provider* (FIDO2 credential storage/autofill) at v1 — tracked as a fast-follow, not a launch blocker.
- Not building our own cryptographic primitives. We use vetted libraries only.
- No on-prem Active Directory write-back / SCIM provisioning at v1 (SSO login via OIDC is in; full directory sync is later).

---

## 4. Success criteria

| Dimension | v1 success looks like |
|---|---|
| Security | Passing an independent third-party crypto/security review with no critical/high findings unresolved before 1.0. Threat model documented and published. |
| Functionality | A new org can: install the server, create users, define ≥2 groups, scope ≥2 collections, and have members log in from desktop + extension and only see their entitled secrets. |
| Multiplatform | Signed, installable builds for Windows (.msi), macOS (.dmg, notarized), Linux (AppImage + .deb/.rpm or Flatpak), and the extension published to Chrome Web Store + Firefox AMO. |
| Self-host UX | Time-to-first-login under 15 minutes from a clean Docker host following the quickstart. |
| Reliability | Vault unlock p95 < 500 ms on a 1,000-item vault; sync round-trip p95 < 2 s. |
| Openness | License compliance clean; build is reproducible; contribution guide + threat model public. |

(Adoption/community metrics — GitHub stars, # self-host deployments — are tracked but are *not* launch gates.)

---

## 5. Target users & personas

- **Org Admin / IT (primary).** Deploys and operates NadSafe, manages users, groups, collections, and policies. Cares about self-hosting, backups, SSO, audit logs, and least-privilege. (This is your own role at Caleta Homes — the canonical first user.)
- **Team Member (primary).** Day-to-day user who stores personal work credentials and consumes shared collections. Cares about fast unlock, autofill, cross-device sync, and not being locked out.
- **Security/Compliance reviewer (secondary).** Audits the deployment. Cares about the threat model, encryption details, audit trail, and license posture.
- **Self-hoster / OSS contributor (secondary).** Runs NadSafe for a small team or a homelab; may contribute. Cares about easy deployment and clean code.

---

## 6. Scope & platform matrix

### 6.1 v1 platform targets

| Surface | v1 | Tech | Notes |
|---|---|---|---|
| Server | ✅ | Rust (Vaultwarden fork) | Self-host + managed cloud |
| Desktop — Windows | ✅ | Tauri | .msi, code-signed |
| Desktop — macOS | ✅ | Tauri | .dmg, notarized (Apple Developer ID required) |
| Desktop — Linux | ✅ | Tauri | AppImage + Flatpak/.deb/.rpm |
| Browser extension — Chrome/Edge/Brave | ✅ | Web (shared UI) | Manifest V3 |
| Browser extension — Firefox | ✅ | Web (shared UI) | MV3 |
| CLI | ⚠️ stretch | Rust | Useful for admins/scripts; ship if cheap |
| Mobile — Android | ❌ → v2 | Tauri Mobile or native | Reuses core |
| Mobile — iOS | ❌ → v2 | Tauri Mobile or native | Reuses core |

### 6.2 In scope (v1 feature set)

- Account lifecycle: registration, login, master-password change, account recovery via **recovery phrase** (mnemonic) + **email** as a login/2FA reset channel + org/admin recovery (see §8.5).
- Vault item types: login (username/password/URI/TOTP), secure note, card, identity. Custom fields. File attachments (size-capped).
- Folders (personal organization) + Collections (shared, access-controlled).
- Organizations, **Groups**, members, invitations, and per-collection permissions (§8).
- TOTP generator (RFC 6238) stored alongside logins.
- Password generator (length, character classes, passphrase mode).
- Autofill in the browser extension; auto-detection of login forms.
- Cross-device sync.
- 2FA for the NadSafe account itself: TOTP authenticator app + WebAuthn/security keys at minimum; email as fallback.
- SSO login via OpenID Connect (Vaultwarden already supports this upstream).
- Import (from Bitwarden, KeePass, LastPass, CSV) and export.
- Audit/event log (org-level): who accessed/changed what, when.
- Admin policies: minimum master-password strength, KDF floor, session timeout, export restrictions.

### 6.3 Out of scope (v1)

Secrets Manager / SDK for app integration; passkey provider; SCIM/directory write-back; Emergency Access (trusted contact) — deferred to post-1.0; on-device biometric unlock is a fast-follow per-platform, not a launch gate.

---

## 7. Architecture overview

```
                         ┌─────────────────────────────────────────┐
                         │              CLIENTS (own)                │
                         │  Tauri desktop (Win/macOS/Linux)          │
                         │  Browser extension (MV3, shared web UI)   │
                         │  [v2] Android / iOS                       │
                         │                                           │
                         │  Rust crypto core (shared lib)            │
                         │  ── KDF, key hierarchy, EncString,        │
                         │     RSA org keys, item (de)serialization  │
                         └───────────────────┬───────────────────────┘
                                             │  Bitwarden-compatible
                                             │  HTTPS API + sync
                         ┌───────────────────▼───────────────────────┐
                         │           SERVER (Vaultwarden fork)         │
                         │  Rust, single binary + bundled web vault    │
                         │  Stores only ciphertext + metadata          │
                         │  Auth, orgs/groups/collections, sync,       │
                         │  OIDC SSO, push relay, attachments          │
                         └───────────────────┬───────────────────────┘
                                             │
                         ┌───────────────────▼───────────────────────┐
                         │  Data: SQLite (default) / PostgreSQL / MySQL│
                         │  Attachments: local FS or S3-compatible     │
                         └─────────────────────────────────────────────┘
```

### 7.1 Server (Vaultwarden fork)

We fork Vaultwarden as the backend. Rationale: it's a mature, performant Rust implementation of the Bitwarden Client API, supports SQLite/PostgreSQL/MySQL, OIDC SSO, attachments, and runs as a single binary or container. Forking (rather than running it unmodified) lets us: rebrand, add NadSafe-specific admin/audit features, harden defaults, and control our own release cadence.

**Fork discipline:** keep our changes as a thin, rebase-friendly layer on top of upstream so we can pull security fixes. Track upstream as a remote; avoid gratuitous divergence in the API surface so client interop holds. Contribute generally-useful fixes back upstream (AGPL obliges us anyway).

The server stores **only ciphertext and the metadata required to route/sync it** (item IDs, collection membership, revision timestamps, org/group structure). It never sees master passwords or decryption keys.

### 7.2 Clients (Tauri)

New Tauri apps. A single web UI (the vault interface) is shared across desktop and the browser extension; Tauri wraps it for desktop with native OS integration (autostart, secure storage of the unlocked session, OS keychain for "remember device", system tray). A **Rust crypto core** is compiled both to native (for desktop, via Tauri's Rust backend) and to WASM (for the extension and web vault), so the security-critical code is written once and shared.

Why Tauri over Electron: smaller binaries, lower memory, a Rust backend that aligns with the server and lets us share the crypto core natively, and a strong fit for Linux. Tradeoff: Tauri's mobile story (Tauri 2 Mobile) is younger than native — flagged as a v2 risk (§14).

### 7.3 Browser extension

Manifest V3, sharing the web vault UI and the WASM crypto core. Responsibilities: vault unlock, autofill / form detection, TOTP copy, password generation, and communication with the server's sync API. Background service worker handles session/locking per MV3 constraints.

### 7.4 Protocol & API compatibility

Clients speak the **Bitwarden Client API** that the forked server implements. Benefits: a well-specified, battle-tested contract; existing import tooling; and official Bitwarden clients remain usable as a migration/fallback path. **Tension to manage:** we are re-implementing client-side crypto + protocol rather than reusing Bitwarden's client code/SDK. This is deliberate (UX ownership + license cleanliness, §11) but means we must faithfully reproduce the crypto and serialization formats and keep them in sync with any server changes. We treat the protocol/crypto layer as a versioned, heavily-tested module with cross-client conformance tests.

---

## 8. Security model

### 8.1 Threat model (summary)

**Protect against:** a fully compromised server / database (attacker reads all stored data), network attackers (MITM), and a malicious or curious server operator. In all cases, vault plaintext must remain unrecoverable without a user's master password (or org keys).

**Out of model:** a fully compromised *client* endpoint (keylogger/malware on the user's unlocked device), the user choosing a weak master password against an offline attacker who has stolen the vault, and rubber-hose/coercion. We mitigate where possible (KDF hardening, screen-lock timeouts) but do not claim protection against a compromised endpoint.

A full, published threat-model document is a 1.0 deliverable.

### 8.2 Key hierarchy & crypto (inherited from the Bitwarden model)

- **Master password** never leaves the client and is never sent to the server.
- **KDF:** master password → **Argon2id** (default; memory-hard, recommended) or PBKDF2-HMAC-SHA256 (compatibility) → *master key*. Admin policy sets a KDF floor; NadSafe defaults to Argon2id with sane parameters rather than legacy PBKDF2.
- The master key is stretched (HKDF) and used to wrap a randomly-generated **user symmetric key** (AES-256). Vault items are encrypted with this symmetric key.
- **Item encryption:** authenticated symmetric encryption over each field (the Bitwarden `EncString` format: AES-256 with HMAC-SHA256 authentication).
- **Server-side auth:** the server stores a separate password hash (a hash of the KDF output) used only to authenticate the login — it is *not* the key material and cannot decrypt anything.
- **Organization sharing:** each org has an **org symmetric key**. Each member has an **RSA key pair**; the member's public key is used to encrypt the org key to them, so a member can decrypt org/collection data without anyone sharing raw symmetric keys. Collections are encrypted under the org key; access is mediated by which members/groups hold the (encrypted) org key and have collection grants.

We do not invent primitives; we use audited Rust crypto crates and the established Bitwarden constructions.

### 8.3 Account security

- 2FA on the NadSafe account: TOTP + WebAuthn/security keys (FIDO2) at minimum; email fallback.
- Session/auto-lock timeouts (policy-configurable); lock on OS sleep/lock.
- Optional biometric/OS-keychain unlock per platform (fast-follow).
- Rate limiting and brute-force protection on auth endpoints (server).

### 8.4 Transport & deployment hardening

- TLS required end to end; HSTS on the web vault.
- Secure defaults in the shipped Docker image; documented reverse-proxy configs (Caddy/Traefik/nginx) with automatic HTTPS.
- Admin panel gated and disabled-by-default unless a token is set.

### 8.5 Account & vault recovery (zero-knowledge–compatible)

A zero-knowledge server cannot decrypt the vault, so recovery mechanisms must be designed around that constraint. NadSafe ships three distinct, non-interchangeable paths:

1. **Recovery phrase (primary, vault-recovering).** At account creation the client generates a high-entropy mnemonic (BIP39-style word list). It derives a **recovery key** that wraps a copy of the user's symmetric key (the same key the master password wraps). If the user forgets the master password, entering the recovery phrase unwraps the vault key on the client and lets them set a new master password — **without the server ever seeing plaintext**. The phrase is shown once, the user must store it offline, and only its derived public/wrapping material is retained server-side. Losing both master password *and* phrase = unrecoverable (by design).
2. **Email (secondary, access-reset only — does NOT recover the vault).** Email verifies identity and can reset *login credentials / 2FA* and unlock the recovery flow, but email alone can never decrypt the vault. This is stated explicitly in UX copy so users don't assume email = vault recovery.
3. **Organization / admin recovery (for orgs).** With member consent (opt-in policy), an org Owner/Admin can reset a member's account using the org's key material to re-grant access to org collections. This is an org-policy feature, off by default, surfaced transparently to members. It recovers *org/collection* access, governed by the org-key model in §8.2.

**Tradeoff documented:** the recovery phrase shifts a single point of failure to the user's safekeeping of the phrase. We accept this as the only model consistent with zero-knowledge; org recovery covers the "employee left / forgot everything" corporate case for shared data.

---

## 9. Access control: groups, collections & RBAC

This is a headline feature, so it gets its own section.

**Model (aligned with the Bitwarden org model the server already implements):**

- **Organization** — the top-level container owning members, groups, and collections.
- **Collection** — a named bucket of vault items (e.g. "Infrastructure", "Marketing SaaS", "Finance"). Sharing and permissions operate at the collection level.
- **Group** — a named set of members (e.g. "IT", "Front Desk", "Management"). A group is granted access to one or more collections.
- **Member** — a user in the org. Gets effective access = union of (direct collection grants) ∪ (grants via their groups).

**Per-collection permissions** (assignable to a group or directly to a member):

| Permission | Meaning |
|---|---|
| Read-only | View/use items, cannot edit. |
| Read/Write | View and edit items. |
| Manage | Read/write + add/remove items and manage who can access the collection. |
| Hide passwords | View item exists / autofill, but the password field is masked (no reveal/copy-as-text where enforced). |

**Org-level roles:** Owner, Admin, Manager (can manage assigned collections/groups), User, and a custom-role option (post-v1). Owners/Admins manage the org; Managers manage a delegated subset.

**Worked example (Caleta Homes):** Group "Front Desk" → Read-only on collection "Booking Platforms"; Group "IT" → Manage on "Infrastructure" + Read/Write on everything operational; Group "Management" → Read on "Finance". A front-desk hire added to "Front Desk" instantly inherits exactly the booking-platform logins and nothing else — and loses them on removal. No re-sharing, no key redistribution by hand (handled by the org-key/public-key crypto in §8.2).

**Auditability:** every grant change, collection access, and item edit is recorded in the org event log.

---

## 10. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Server | Rust (Vaultwarden fork) | Mature, fast, single-binary, Bitwarden-API-compatible |
| DB | SQLite default; PostgreSQL for scale/managed | Zero-config self-host → robust managed tier |
| Crypto core | Rust → native + WASM | Write security code once, share across all clients |
| Desktop | Tauri 2 | Light, Rust backend, Linux-friendly, shares crypto core |
| Web vault / extension UI | TypeScript + **React** | Shared UI across desktop + extension; largest talent/ecosystem pool for an OSS project |
| Extension | Manifest V3 | Required by Chrome; Firefox MV3-compatible |
| Mobile (v2) | **Tauri 2 Mobile** | Commit to Tauri Mobile to reuse the Rust crypto core + React UI across all six targets |
| Build/CI | GitHub Actions; reproducible builds; signing pipeline | Trust + supply-chain integrity |
| Packaging | .msi / .dmg (notarized) / AppImage + Flatpak | Native install per OS |

UI framework is **React** (decided). Visual design/component library is still design's call and will be settled iteratively.

---

## 11. Licensing strategy ⚠️ (decision-critical)

Forking Vaultwarden and re-implementing the Bitwarden client protocol creates hard license constraints — getting this right is non-negotiable for an OSS project.

- **Vaultwarden is AGPL-3.0.** Any fork we distribute (and, critically, any *network use* of a modified version — that's the "A" in AGPL) must publish its complete corresponding source under AGPL-3.0. **This directly affects the managed-cloud tier:** offering NadSafe-server-as-a-service means we must make our exact server source available to users of that service. **Decision:** the managed tier is a **paid convenience tier** (we charge for hosting, ops, support, data-residency, and SLA — *not* for proprietary code), with full server source published per AGPL. This is the "open-core-free, pay-for-hosting" model, fully AGPL-compliant.
- **EU / Spain data residency.** The managed tier hosts in the EU (target: Spain or EU-region provider) to meet GDPR and corporate data-residency expectations. Even though the server holds only ciphertext, hosting region, a DPA, sub-processor list, and a privacy/retention policy are required for EU corporate customers. Self-hosters choose their own region.
- **Clients:** Bitwarden's clients and `sdk-internal` are GPL-3.0 (after the Oct 2024 relicensing). We do **not** depend on Bitwarden's `sdk-secrets` (which remains under the proprietary Bitwarden License and is not used by clients). Our clean-room clients will be **GPL-3.0** to stay copyleft-consistent and dependency-clean.
- **Implication for "free for corporate use":** AGPL/GPL permit commercial and internal corporate use freely; they impose source-availability obligations on *distribution* and *network service*, not on internal use. This fits "free, open source, corporate" perfectly.
- **Trademark:** "NadSafe" name/logo kept under a separate trademark policy so forks can't pass themselves off as official (standard OSS practice).
- **Contributions: CLA (decided).** External contributors sign a Contributor License Agreement assigning sufficient rights to the project. This keeps relicensing/enforcement options open (e.g. a future dual-license for the paid tier) and protects the project legally — at the cost of slightly higher contributor friction vs a lightweight DCO. Worth it given the commercial cloud tier.
- **Action:** legal review of the AGPL network-use obligation + EU DPA/GDPR posture before launching the managed tier.

(Not legal advice — a lawyer should confirm the AGPL service obligations before the cloud tier ships.)

---

## 12. Key decisions & tradeoffs

1. **Fork the server, build the clients.** Fast, secure backend; full UX control on the front. Cost: we own a protocol/crypto re-implementation and must track upstream + Bitwarden API changes. *Accepted.*
2. **Keep Bitwarden API compatibility.** Free interop, import tooling, and an official-client fallback. Cost: constrains our protocol freedom. *Accepted — net positive.*
3. **Tauri over Electron.** Lighter, Rust-aligned, shares crypto core. Cost: younger mobile story. *Accepted; mobile committed to Tauri 2 Mobile with a de-risking spike (§13 Phase 7).*
4. **Self-host + paid managed cloud (EU).** Broad reach + a funding path. Cost: AGPL source obligations (we publish server source even for the paid tier) + EU/GDPR ops/compliance. *Accepted; cloud tier gated behind legal review.*
5. **Public OSS from day one.** Community + auditability. Cost: must invest in docs, threat model, contribution process at launch. *Accepted.*
6. **API compatibility through 1.0, additive extensions after.** Keep the Bitwarden API contract (least effort, free interop/import/fallback, no security cost since the API carries only ciphertext); reserve versioned NadSafe-native extensions for post-1.0 additive features so compat never breaks. *Accepted.*
7. **Recovery phrase as primary recovery.** Only model consistent with zero-knowledge. Cost: user must safeguard the phrase. *Accepted; mitigated by org/admin recovery for shared data.*

---

## 13. Roadmap (phased)

**Phase 0 — Foundations (weeks 1–4).** Fork & rebrand Vaultwarden; stand up dev infra; reproducible-build + signing pipeline skeleton; extract/define the shared Rust crypto core; publish initial threat model draft.

**Phase 1 — Walking skeleton (weeks 5–12).** Tauri desktop (Linux first) that can register, log in, unlock, list/edit personal items against the forked server. Crypto core conformance tests vs Bitwarden vectors.

**Phase 2 — Sharing & groups (weeks 10–16, overlaps).** Organizations, groups, collections, per-collection permissions end to end. Admin UI for managing them. Audit log.

**Phase 3 — Browser extension (weeks 14–20).** MV3 extension sharing UI + WASM crypto core; autofill, TOTP, generator; Chrome + Firefox.

**Phase 4 — Cross-platform desktop + polish (weeks 18–24).** Windows + macOS builds, signing/notarization; import/export; 2FA (TOTP + WebAuthn); OIDC SSO; admin policies.

**Phase 5 — Hardening & 1.0 (weeks 24–30).** Third-party security review; fix findings; performance pass; docs/quickstart; reproducible builds verified; store submissions. **1.0 = security review passed + all v1 platforms shipped.**

**Phase 6 — Managed cloud (post-1.0).** Multi-tenant **paid** hosted tier in the **EU** (AGPL source published), billing/ops, status/SLA, GDPR DPA + sub-processor docs. Gated on legal review.

**Phase 7 — Mobile (post-1.0).** Android then iOS on **Tauri 2 Mobile**, reusing the Rust crypto core + React UI. Early spike to de-risk; native fallback only if a blocking limitation surfaces.

(Timeline assumes a small team; treat week numbers as relative sequencing, not commitments.)

---

## 14. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Crypto re-implementation introduces a vulnerability | Critical | Reuse audited crates; conformance tests vs known vectors; third-party review before 1.0; never roll our own primitives. |
| Upstream Vaultwarden divergence breaks rebases | High | Thin fork layer; track upstream remote; contribute fixes back; CI against upstream API. |
| AGPL service obligation underestimated for cloud tier | High (legal) | Legal review before cloud launch; publish server source; gate Phase 6 on sign-off. |
| Tauri 2 Mobile too immature for v2 | Medium | Spike early; fall back to native mobile reusing the Rust crypto core. |
| MV3 limitations hurt extension autofill/session | Medium | Prototype the service-worker session model in Phase 3; learn from Bitwarden's MV3 migration. |
| macOS notarization / Apple Developer account dependency | Medium | Budget for Apple Developer Program; automate notarization in CI. |
| Scope creep (Secrets Manager, passkeys, SCIM) delays 1.0 | Medium | Explicit non-goals (§3.2); park requests behind 1.0. |
| Account recovery vs zero-knowledge tension | Medium | Recovery-phrase model (§8.5) recovers the vault client-side; email is access-reset only; org/admin recovery covers shared data. UX copy makes the "lose phrase + password = unrecoverable" tradeoff explicit. |
| Users misunderstand email ≠ vault recovery and lose data | Medium | Unambiguous onboarding UX; force recovery-phrase capture/confirmation at signup; never imply email restores the vault. |
| CLA deters contributors | Low–Med | Automate CLA signing (bot); document the rationale (enables the funded cloud tier); keep the process one-click. |

---

## 15. Decisions & remaining open questions

### 15.1 Resolved (2026-06-05)

1. **Cloud tier business model** — ✅ **Paid managed convenience tier**, full server source published per AGPL. Charge for hosting/ops/SLA/data-residency, not code. (§11, §13 Phase 6)
2. **Contributions** — ✅ **CLA** (enables future relicensing/dual-license options for the paid tier). (§11)
3. **UI framework** — ✅ **React** (shared across desktop + extension). (§10)
4. **Account recovery** — ✅ **Recovery phrase (primary, vault-recovering)** + **email (access/2FA reset only)** + **org/admin recovery** for shared data. (§8.5)
5. **Mobile** — ✅ **Tauri 2 Mobile**, reusing the Rust core + React UI; de-risking spike before committing native fallback. (§13 Phase 7)
6. **Managed-cloud region** — ✅ **EU (Spain/EU provider)** for GDPR + corporate data residency. (§11)
7. **API compatibility** — ✅ **Maintain Bitwarden API compatibility through 1.0; additive, versioned NadSafe extensions only, post-1.0.** Easiest path, free interop, no security cost. (§12.6)

### 15.2 Still open (need answers before/at build start)

- **Recovery-phrase word list & entropy:** standard BIP39 (2048 words, 12/24 words) vs a custom list? Recommend BIP39 for tooling maturity — confirm.
- **Org recovery default:** opt-in or opt-out for new orgs? (Recommend opt-in / off-by-default for trust; orgs enable consciously.)
- **EU provider choice:** specific host/region (e.g. Hetzner DE/FI, OVH/Scaleway FR, AWS eu-south-2 Spain). Drives cost + DPA paperwork.
- **Funding mechanics for the paid tier:** pricing model (per-seat? flat?), billing provider, and whether a free hosted tier exists alongside.

**Resolved:** Trademark/governance — Nadir holds the "NadSafe" mark and is the CLA counterparty (sole maintainer). Revisit a legal entity/foundation if/when revenue or co-maintainers arrive.

---

## 16. Appendix

### 16.1 Glossary

- **Zero-knowledge:** the server cannot read user data; only clients hold the keys.
- **KDF:** Key Derivation Function (Argon2id / PBKDF2) turning a master password into key material.
- **EncString:** Bitwarden's authenticated-encryption envelope for an encrypted field.
- **Collection:** access-controlled shared bucket of items.
- **Group:** named set of members granted collection access.

### 16.2 References

- Vaultwarden — https://github.com/dani-garcia/vaultwarden
- Bitwarden — https://github.com/bitwarden
- Vaultwarden AGPLv3 relicense discussion — https://github.com/dani-garcia/vaultwarden/discussions/2450
- Bitwarden SDK license episode (2024) — https://www.theregister.com/2024/11/04/bitwarden_gpls_password_manager/
- Bitwarden SDK relicensed to GPLv3 — https://news.ycombinator.com/item?id=41940580
- Tauri — https://tauri.app

---

*Sign-off required before any build work begins. Reply with approval, or mark up sections 3, 9, 11, and 15 — those carry the most consequential decisions.*
