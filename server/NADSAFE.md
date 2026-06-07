# NadSafe Server

Fork of [Vaultwarden](https://github.com/dani-garcia/vaultwarden) — a Rust implementation of the Bitwarden Client API.

## Setup

```bash
git remote add upstream https://github.com/dani-garcia/vaultwarden.git
git fetch upstream
git checkout -b server-base upstream/main
```

## Fork discipline

- Keep changes as a thin rebase-friendly layer on top of upstream.
- Track upstream as a remote; pull security fixes promptly.
- Contribute generally-useful fixes upstream (AGPL obligation).
- Never diverge the API surface — Bitwarden client compatibility must hold.

## NadSafe-specific changes (planned)

- Rebrand (name, default config values)
- Hardened defaults (Argon2id floor, TLS enforcement, admin panel off-by-default)
- Audit log API extensions
- NadSafe-native admin features (org management, policy enforcement)

## License

AGPL-3.0 (inherited from Vaultwarden). Full server source published per AGPL network-use obligation.
