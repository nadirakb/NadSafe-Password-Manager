//! BIP39-style recovery phrase — wraps a copy of the user symmetric key.
//!
//! At account creation, a 24-word mnemonic is generated. Its entropy is used
//! via HKDF to produce a recovery symmetric key that wraps the user key.
//! Losing both master password and recovery phrase = permanent vault loss (by design).

use bip39::{Language, Mnemonic};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::{
    enc_string::{EncString, SymmetricKey},
    error::CryptoError,
    keys::UserKey,
};

/// Generate a new 24-word BIP39 recovery phrase (256-bit entropy).
pub fn generate_recovery_phrase() -> Mnemonic {
    use rand::RngCore;
    let mut entropy = [0u8; 32]; // 256 bits → 24 words
    rand::thread_rng().fill_bytes(&mut entropy);
    Mnemonic::from_entropy_in(Language::English, &entropy)
        .expect("32-byte entropy always produces valid 24-word mnemonic")
}

/// Derive a 64-byte recovery symmetric key from the BIP39 mnemonic's entropy.
fn recovery_key_from_mnemonic(mnemonic: &Mnemonic) -> Result<Zeroizing<[u8; 64]>, CryptoError> {
    let entropy = Zeroizing::new(mnemonic.to_entropy());
    let hk = Hkdf::<Sha256>::new(Some(b"nadsafe-recovery-v1"), &entropy);
    let mut key = Zeroizing::new([0u8; 64]);
    hk.expand(b"recovery-sym-key", &mut *key)
        .map_err(|e| CryptoError::Kdf(e.to_string()))?;
    Ok(key)
}

/// Wrap the user's symmetric key with the recovery key.
/// Store the returned EncString server-side; show the phrase to the user once.
pub fn wrap_user_key_with_recovery(
    user_key: &UserKey,
    mnemonic: &Mnemonic,
) -> Result<EncString, CryptoError> {
    let recovery_key_bytes = recovery_key_from_mnemonic(mnemonic)?;
    let sym = SymmetricKey::from_bytes(&*recovery_key_bytes)?;
    EncString::encrypt(&user_key.raw_bytes(), &sym)
}

/// Unwrap the user's symmetric key using the recovery phrase.
/// Called during account recovery to restore vault access.
pub fn unwrap_user_key_with_recovery(
    enc_user_key: &EncString,
    mnemonic: &Mnemonic,
) -> Result<UserKey, CryptoError> {
    let recovery_key_bytes = recovery_key_from_mnemonic(mnemonic)?;
    let sym = SymmetricKey::from_bytes(&*recovery_key_bytes)?;
    let raw = enc_user_key.decrypt(&sym)?;
    UserKey::from_bytes(&raw)
}

/// Parse a BIP39 mnemonic from a user-supplied string.
pub fn parse_recovery_phrase(phrase: &str) -> Result<Mnemonic, CryptoError> {
    Mnemonic::parse_in_normalized(Language::English, phrase)
        .map_err(|_| CryptoError::InvalidRecoveryPhrase)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kdf::{derive_master_key, Argon2idParams, Kdf};
    use crate::keys::MasterKey;

    #[test]
    fn recovery_roundtrip() {
        let kdf = Kdf::Argon2id(Argon2idParams {
            m_cost: 8192,
            t_cost: 1,
            p_cost: 1,
        });
        let mk_bytes = derive_master_key(b"password", "user@test.com", &kdf).unwrap();
        let mk = MasterKey(*mk_bytes);
        let (user_key, _enc_user_key) = mk.generate_user_key().unwrap();

        let phrase = generate_recovery_phrase();
        let wrapped = wrap_user_key_with_recovery(&user_key, &phrase).unwrap();

        let recovered = unwrap_user_key_with_recovery(&wrapped, &phrase).unwrap();
        assert_eq!(user_key.raw_bytes(), recovered.raw_bytes());
    }

    #[test]
    fn wrong_phrase_fails() {
        let kdf = Kdf::Argon2id(Argon2idParams {
            m_cost: 8192,
            t_cost: 1,
            p_cost: 1,
        });
        let mk_bytes = derive_master_key(b"password", "user@test.com", &kdf).unwrap();
        let mk = MasterKey(*mk_bytes);
        let (user_key, _) = mk.generate_user_key().unwrap();

        let phrase = generate_recovery_phrase();
        let wrong_phrase = generate_recovery_phrase();
        let wrapped = wrap_user_key_with_recovery(&user_key, &phrase).unwrap();

        let result = unwrap_user_key_with_recovery(&wrapped, &wrong_phrase);
        assert!(result.is_err());
    }

    #[test]
    fn phrase_is_24_words() {
        let phrase = generate_recovery_phrase();
        assert_eq!(phrase.to_string().split_whitespace().count(), 24);
    }

    #[test]
    fn parse_roundtrip() {
        let phrase = generate_recovery_phrase();
        let s = phrase.to_string();
        let parsed = parse_recovery_phrase(&s).unwrap();
        assert_eq!(phrase.to_entropy(), parsed.to_entropy());
    }
}
