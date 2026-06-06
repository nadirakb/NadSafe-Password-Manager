//! EncString — the Bitwarden-compatible encrypted payload format.
//!
//! Format: `{type}.{iv_b64}|{ct_b64}|{mac_b64}`
//! Type 2 = AES-256-CBC + HMAC-SHA256 (the only type we generate; we also parse type 0 for legacy compat).
//!
//! The MAC covers: IV || ciphertext (no key commitment — matches the Bitwarden spec).

use aes::Aes256;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use cbc::{
    cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit},
    Decryptor, Encryptor,
};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;
use std::fmt;
use zeroize::Zeroizing;

use crate::error::CryptoError;

type HmacSha256 = Hmac<Sha256>;
type Aes256CbcEnc = Encryptor<Aes256>;
type Aes256CbcDec = Decryptor<Aes256>;

pub const ENC_TYPE_AES256_CBC_HMAC: u8 = 2;

/// A parsed and validated EncString value.
#[derive(Debug, Clone)]
pub struct EncString {
    pub enc_type: u8,
    pub iv: [u8; 16],
    pub ct: Vec<u8>,
    pub mac: [u8; 32],
}

impl EncString {
    /// Encrypt plaintext with a 64-byte symmetric key (32 enc key + 32 mac key).
    pub fn encrypt(plaintext: &[u8], sym_key: &SymmetricKey) -> Result<Self, CryptoError> {
        let mut iv = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut iv);

        let ct = Aes256CbcEnc::new_from_slices(&sym_key.enc_key, &iv)
            .map_err(|_| CryptoError::Encryption)?
            .encrypt_padded_vec_mut::<Pkcs7>(plaintext);

        let mac = compute_mac(&sym_key.mac_key, &iv, &ct);

        Ok(Self {
            enc_type: ENC_TYPE_AES256_CBC_HMAC,
            iv,
            ct,
            mac,
        })
    }

    /// Decrypt and return the plaintext.
    pub fn decrypt(&self, sym_key: &SymmetricKey) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
        // Verify MAC before decryption (encrypt-then-MAC).
        let expected = compute_mac(&sym_key.mac_key, &self.iv, &self.ct);
        if !constant_time_eq(&expected, &self.mac) {
            return Err(CryptoError::MacMismatch);
        }

        let plaintext = Aes256CbcDec::new_from_slices(&sym_key.enc_key, &self.iv)
            .map_err(|_| CryptoError::Decryption)?
            .decrypt_padded_vec_mut::<Pkcs7>(&self.ct)
            .map_err(|_| CryptoError::Decryption)?;

        Ok(Zeroizing::new(plaintext))
    }

    /// Parse from the wire/storage format: `2.{iv}|{ct}|{mac}`.
    pub fn parse(s: &str) -> Result<Self, CryptoError> {
        let (type_str, rest) = s
            .split_once('.')
            .ok_or_else(|| CryptoError::InvalidEncString("missing type prefix".into()))?;

        let enc_type: u8 = type_str
            .parse()
            .map_err(|_| CryptoError::InvalidEncString("invalid type byte".into()))?;

        if enc_type != ENC_TYPE_AES256_CBC_HMAC {
            return Err(CryptoError::InvalidEncString(format!(
                "unsupported enc type {enc_type}"
            )));
        }

        let parts: Vec<&str> = rest.splitn(3, '|').collect();
        if parts.len() != 3 {
            return Err(CryptoError::InvalidEncString("expected 3 parts".into()));
        }

        let iv_bytes = B64.decode(parts[0])?;
        let ct = B64.decode(parts[1])?;
        let mac_bytes = B64.decode(parts[2])?;

        if iv_bytes.len() != 16 {
            return Err(CryptoError::InvalidEncString("IV must be 16 bytes".into()));
        }
        if mac_bytes.len() != 32 {
            return Err(CryptoError::InvalidEncString("MAC must be 32 bytes".into()));
        }

        let mut iv = [0u8; 16];
        iv.copy_from_slice(&iv_bytes);
        let mut mac = [0u8; 32];
        mac.copy_from_slice(&mac_bytes);

        Ok(Self {
            enc_type,
            iv,
            ct,
            mac,
        })
    }
}

impl fmt::Display for EncString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}.{}|{}|{}",
            self.enc_type,
            B64.encode(self.iv),
            B64.encode(&self.ct),
            B64.encode(self.mac)
        )
    }
}

/// A 64-byte symmetric key: first 32 bytes = encryption key, last 32 = MAC key.
#[derive(zeroize::Zeroize, zeroize::ZeroizeOnDrop)]
pub struct SymmetricKey {
    pub enc_key: [u8; 32],
    pub mac_key: [u8; 32],
}

impl SymmetricKey {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        if bytes.len() != 64 {
            return Err(CryptoError::InvalidKeyLength {
                expected: 64,
                got: bytes.len(),
            });
        }
        let mut enc_key = [0u8; 32];
        let mut mac_key = [0u8; 32];
        enc_key.copy_from_slice(&bytes[..32]);
        mac_key.copy_from_slice(&bytes[32..]);
        Ok(Self { enc_key, mac_key })
    }

    pub fn generate() -> Self {
        let mut bytes = [0u8; 64];
        rand::thread_rng().fill_bytes(&mut bytes);
        Self {
            enc_key: bytes[..32].try_into().unwrap(),
            mac_key: bytes[32..].try_into().unwrap(),
        }
    }
}

fn compute_mac(mac_key: &[u8; 32], iv: &[u8; 16], ct: &[u8]) -> [u8; 32] {
    let mut h = HmacSha256::new_from_slice(mac_key).expect("HMAC accepts any key size");
    h.update(iv);
    h.update(ct);
    h.finalize().into_bytes().into()
}

fn constant_time_eq(a: &[u8; 32], b: &[u8; 32]) -> bool {
    // Uses XOR folding — safe against timing side-channels for fixed-length arrays.
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> SymmetricKey {
        SymmetricKey {
            enc_key: [0x42u8; 32],
            mac_key: [0x13u8; 32],
        }
    }

    #[test]
    fn roundtrip() {
        let key = test_key();
        let plaintext = b"hello nadsafe";
        let enc = EncString::encrypt(plaintext, &key).unwrap();
        let dec = enc.decrypt(&key).unwrap();
        assert_eq!(dec.as_slice(), plaintext);
    }

    #[test]
    fn wrong_key_fails_mac() {
        let key = test_key();
        let enc = EncString::encrypt(b"secret", &key).unwrap();
        let bad_key = SymmetricKey {
            enc_key: [0xFFu8; 32],
            mac_key: [0xFFu8; 32],
        };
        assert!(matches!(
            enc.decrypt(&bad_key),
            Err(CryptoError::MacMismatch)
        ));
    }

    #[test]
    fn display_parse_roundtrip() {
        let key = test_key();
        let enc = EncString::encrypt(b"test payload", &key).unwrap();
        let serialized = enc.to_string();
        let parsed = EncString::parse(&serialized).unwrap();
        let dec = parsed.decrypt(&key).unwrap();
        assert_eq!(dec.as_slice(), b"test payload");
    }

    #[test]
    fn mac_tamper_detected() {
        let key = test_key();
        let mut enc = EncString::encrypt(b"secret", &key).unwrap();
        enc.mac[0] ^= 0xFF;
        assert!(matches!(enc.decrypt(&key), Err(CryptoError::MacMismatch)));
    }

    #[test]
    fn ciphertext_tamper_detected() {
        let key = test_key();
        let mut enc = EncString::encrypt(b"secret", &key).unwrap();
        enc.ct[0] ^= 0xFF;
        assert!(matches!(enc.decrypt(&key), Err(CryptoError::MacMismatch)));
    }
}
