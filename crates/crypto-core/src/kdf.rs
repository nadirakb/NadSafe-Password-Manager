//! KDF layer: master password → master key.
//! Implements Bitwarden-compatible Argon2id and PBKDF2-HMAC-SHA256 derivation.

use argon2::{Algorithm, Argon2, Params, Version};
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::error::CryptoError;

pub const ARGON2_DEFAULT_M_COST: u32 = 65536; // 64 MiB
pub const ARGON2_DEFAULT_T_COST: u32 = 3;
pub const ARGON2_DEFAULT_P_COST: u32 = 4;
pub const PBKDF2_DEFAULT_ITERATIONS: u32 = 600_000;

/// KDF algorithm selector, matching the Bitwarden API enum.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Kdf {
    Argon2id(Argon2idParams),
    Pbkdf2(Pbkdf2Params),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Argon2idParams {
    /// Memory cost in KiB.
    pub m_cost: u32,
    /// Time cost (iterations).
    pub t_cost: u32,
    /// Parallelism.
    pub p_cost: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Pbkdf2Params {
    pub iterations: u32,
}

impl Default for Argon2idParams {
    fn default() -> Self {
        Self {
            m_cost: ARGON2_DEFAULT_M_COST,
            t_cost: ARGON2_DEFAULT_T_COST,
            p_cost: ARGON2_DEFAULT_P_COST,
        }
    }
}

impl Default for Kdf {
    fn default() -> Self {
        Kdf::Argon2id(Argon2idParams::default())
    }
}

/// Policy-enforced KDF floors.
pub struct KdfParams {
    pub min_argon2_m_cost: u32,
    pub min_argon2_t_cost: u32,
    pub min_pbkdf2_iterations: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            min_argon2_m_cost: 65536,
            min_argon2_t_cost: 3,
            min_pbkdf2_iterations: 600_000,
        }
    }
}

/// Derive a 32-byte master key from the master password and email (salt).
///
/// Email is lowercased and UTF-8 encoded to match the Bitwarden spec.
pub fn derive_master_key(
    password: &[u8],
    email: &str,
    kdf: &Kdf,
) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    let salt = email.to_lowercase();
    let salt = salt.as_bytes();
    let mut key = Zeroizing::new([0u8; 32]);

    match kdf {
        Kdf::Argon2id(p) => {
            let params = Params::new(p.m_cost, p.t_cost, p.p_cost, Some(32))
                .map_err(|e| CryptoError::Kdf(e.to_string()))?;
            let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
            argon2
                .hash_password_into(password, salt, key.as_mut())
                .map_err(|e| CryptoError::Kdf(e.to_string()))?;
        }
        Kdf::Pbkdf2(p) => {
            pbkdf2_hmac::<Sha256>(password, salt, p.iterations, key.as_mut());
        }
    }

    Ok(key)
}

/// Derive the server-auth hash from the master key.
/// This is what the server stores — it cannot decrypt the vault.
/// hash = PBKDF2(master_key, master_password, 1 iteration)
pub fn derive_auth_hash(master_key: &[u8; 32], password: &[u8]) -> [u8; 32] {
    let mut hash = [0u8; 32];
    pbkdf2_hmac::<Sha256>(master_key, password, 1, &mut hash);
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argon2id_deterministic() {
        let kdf = Kdf::Argon2id(Argon2idParams {
            m_cost: 65536,
            t_cost: 3,
            p_cost: 4,
        });
        let k1 = derive_master_key(b"password", "user@example.com", &kdf).unwrap();
        let k2 = derive_master_key(b"password", "user@example.com", &kdf).unwrap();
        assert_eq!(*k1, *k2);
    }

    #[test]
    fn pbkdf2_deterministic() {
        let kdf = Kdf::Pbkdf2(Pbkdf2Params { iterations: 600_000 });
        let k1 = derive_master_key(b"password", "user@example.com", &kdf).unwrap();
        let k2 = derive_master_key(b"password", "user@example.com", &kdf).unwrap();
        assert_eq!(*k1, *k2);
    }

    #[test]
    fn argon2id_and_pbkdf2_differ() {
        let kdf_a = Kdf::Argon2id(Argon2idParams::default());
        let kdf_b = Kdf::Pbkdf2(Pbkdf2Params { iterations: 600_000 });
        let ka = derive_master_key(b"password", "user@example.com", &kdf_a).unwrap();
        let kb = derive_master_key(b"password", "user@example.com", &kdf_b).unwrap();
        assert_ne!(*ka, *kb);
    }

    #[test]
    fn email_case_insensitive() {
        let kdf = Kdf::Argon2id(Argon2idParams { m_cost: 8192, t_cost: 1, p_cost: 1 });
        let k1 = derive_master_key(b"pw", "Test@Example.COM", &kdf).unwrap();
        let k2 = derive_master_key(b"pw", "test@example.com", &kdf).unwrap();
        assert_eq!(*k1, *k2);
    }
}
