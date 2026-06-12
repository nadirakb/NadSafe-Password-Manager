//! Recovery phrase — wraps a copy of the user symmetric key.
//!
//! Wire-compatible with the web client (`clients/web/src/lib/crypto/recovery.ts`):
//!   * entropy: 32 random bytes
//!   * phrase: 64 lowercase hex chars shown as 8 space-separated groups of 8
//!   * recovery key: HKDF-Expand-SHA256(PRK = entropy, info = "nadsafe-recovery-v1", L = 64)
//!     — first 32 bytes = enc key, last 32 = mac key (no extract phase)
//!   * wrapped user key: standard type-2 EncString
//!
//! Both implementations are pinned to the same test vector below; change one
//! side only together with the other. Losing both master password and
//! recovery phrase = permanent vault loss (by design).

use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::{
    enc_string::{EncString, SymmetricKey},
    error::CryptoError,
    keys::UserKey,
};

const RECOVERY_INFO: &[u8] = b"nadsafe-recovery-v1";

/// Generate fresh recovery entropy (32 random bytes).
pub fn generate_recovery_entropy() -> Zeroizing<[u8; 32]> {
    let mut entropy = Zeroizing::new([0u8; 32]);
    rand::thread_rng().fill_bytes(&mut *entropy);
    entropy
}

/// Encode entropy as the human-readable phrase: 8 groups of 8 hex chars.
pub fn entropy_to_phrase(entropy: &[u8; 32]) -> String {
    let hex: String = entropy.iter().map(|b| format!("{b:02x}")).collect();
    hex.as_bytes()
        .chunks(8)
        .map(|c| std::str::from_utf8(c).expect("hex is ASCII"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Parse a user-supplied phrase back to entropy. Whitespace-tolerant,
/// accepts upper- or lowercase hex.
pub fn phrase_to_entropy(phrase: &str) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    let hex: String = phrase.chars().filter(|c| !c.is_whitespace()).collect();
    if hex.len() != 64 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(CryptoError::InvalidRecoveryPhrase);
    }
    let mut entropy = Zeroizing::new([0u8; 32]);
    for (i, byte) in entropy.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
            .map_err(|_| CryptoError::InvalidRecoveryPhrase)?;
    }
    Ok(entropy)
}

/// Derive the 64-byte recovery symmetric key from entropy.
/// HKDF-Expand only — the entropy is used directly as the PRK, matching the
/// web client's derivation (T(1) || T(2) for a 64-byte output).
fn recovery_key_from_entropy(entropy: &[u8; 32]) -> Result<Zeroizing<[u8; 64]>, CryptoError> {
    let hk = Hkdf::<Sha256>::from_prk(entropy).map_err(|e| CryptoError::Kdf(e.to_string()))?;
    let mut key = Zeroizing::new([0u8; 64]);
    hk.expand(RECOVERY_INFO, &mut *key)
        .map_err(|e| CryptoError::Kdf(e.to_string()))?;
    Ok(key)
}

/// Wrap the user's symmetric key with the recovery key.
/// Persist the returned EncString; show the phrase to the user once.
pub fn wrap_user_key_with_recovery(
    user_key: &UserKey,
    entropy: &[u8; 32],
) -> Result<EncString, CryptoError> {
    let recovery_key_bytes = recovery_key_from_entropy(entropy)?;
    let sym = SymmetricKey::from_bytes(&*recovery_key_bytes)?;
    EncString::encrypt(&user_key.raw_bytes(), &sym)
}

/// Unwrap the user's symmetric key using the recovery phrase.
/// Called during account recovery to restore vault access.
pub fn unwrap_user_key_with_recovery(
    enc_user_key: &EncString,
    phrase: &str,
) -> Result<UserKey, CryptoError> {
    let entropy = phrase_to_entropy(phrase)?;
    let recovery_key_bytes = recovery_key_from_entropy(&entropy)?;
    let sym = SymmetricKey::from_bytes(&*recovery_key_bytes)?;
    let raw = enc_user_key.decrypt(&sym)?;
    UserKey::from_bytes(&raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kdf::{derive_master_key, Argon2idParams, Kdf};
    use crate::keys::MasterKey;

    fn test_user_key() -> UserKey {
        let kdf = Kdf::Argon2id(Argon2idParams {
            m_cost: 8192,
            t_cost: 1,
            p_cost: 1,
        });
        let mk_bytes = derive_master_key(b"password", "user@test.com", &kdf).unwrap();
        let mk = MasterKey(*mk_bytes);
        mk.generate_user_key().unwrap().0
    }

    /// Shared vector with the web client (recovery.test.ts) — both sides must
    /// derive these exact keys from entropy 0x00..0x1f or recovery blobs stop
    /// round-tripping between implementations.
    #[test]
    fn cross_implementation_vector() {
        let mut entropy = [0u8; 32];
        for (i, b) in entropy.iter_mut().enumerate() {
            *b = i as u8;
        }
        let key = recovery_key_from_entropy(&entropy).unwrap();
        assert_eq!(
            hex(&key[..32]),
            "8156d02754e1e4833d828086d0dddbecde161e86a6653fcbf8d3fc35e2255789",
        );
        assert_eq!(
            hex(&key[32..]),
            "e91ce477458041e028ebcba0ec20dddc70680ecf5f695295ce91f8a54c0fdce5",
        );
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn recovery_roundtrip() {
        let user_key = test_user_key();
        let entropy = generate_recovery_entropy();
        let phrase = entropy_to_phrase(&entropy);
        let wrapped = wrap_user_key_with_recovery(&user_key, &entropy).unwrap();

        let recovered = unwrap_user_key_with_recovery(&wrapped, &phrase).unwrap();
        assert_eq!(user_key.raw_bytes(), recovered.raw_bytes());
    }

    #[test]
    fn wrong_phrase_fails() {
        let user_key = test_user_key();
        let entropy = generate_recovery_entropy();
        let wrong_phrase = entropy_to_phrase(&generate_recovery_entropy());
        let wrapped = wrap_user_key_with_recovery(&user_key, &entropy).unwrap();

        assert!(unwrap_user_key_with_recovery(&wrapped, &wrong_phrase).is_err());
    }

    #[test]
    fn phrase_format_is_8_groups_of_8_hex() {
        let phrase = entropy_to_phrase(&generate_recovery_entropy());
        let groups: Vec<&str> = phrase.split(' ').collect();
        assert_eq!(groups.len(), 8);
        for g in groups {
            assert_eq!(g.len(), 8);
            assert!(g.chars().all(|c| c.is_ascii_hexdigit()));
        }
    }

    #[test]
    fn phrase_parse_roundtrip_and_validation() {
        let entropy = generate_recovery_entropy();
        let phrase = entropy_to_phrase(&entropy);
        assert_eq!(*phrase_to_entropy(&phrase).unwrap(), *entropy);
        // uppercase + extra whitespace tolerated
        assert_eq!(
            *phrase_to_entropy(&phrase.to_uppercase().replace(' ', "  ")).unwrap(),
            *entropy,
        );
        assert!(phrase_to_entropy("too short").is_err());
        assert!(phrase_to_entropy(&"zz".repeat(32)).is_err());
    }
}
