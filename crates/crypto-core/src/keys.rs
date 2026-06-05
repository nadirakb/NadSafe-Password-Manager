//! Key hierarchy: master key → user symmetric key → vault item encryption.
//!
//! Follows the Bitwarden key hierarchy exactly:
//!   1. master_key = KDF(password, email)                        [kdf.rs]
//!   2. stretched_key = HKDF-SHA256(master_key, "enc" + "mac")  [this file]
//!   3. user_sym_key = random 64-byte key, wrapped by stretched_key
//!   4. Vault items encrypted with user_sym_key (or org_sym_key)
//!   5. Org key: random 64-byte key, RSA-encrypted to each member

use hkdf::Hkdf;
use rand::RngCore;
use rsa::{
    pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey},
    Oaep, RsaPrivateKey, RsaPublicKey,
};
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::{
    enc_string::{EncString, SymmetricKey},
    error::CryptoError,
};

/// Stretch the 32-byte master key into a 64-byte key (enc + mac) via HKDF-Expand.
///
/// Bitwarden skips the HKDF extract phase — the master key IS the PRK.
/// Two separate expand calls with info="enc" and info="mac".
pub fn stretch_master_key(master_key: &[u8; 32]) -> Result<Zeroizing<[u8; 64]>, CryptoError> {
    // from_prk skips extract, treating master_key directly as PRK.
    let hk = Hkdf::<Sha256>::from_prk(master_key)
        .map_err(|e| CryptoError::Kdf(e.to_string()))?;
    let mut stretched = Zeroizing::new([0u8; 64]);
    let mut enc_key = [0u8; 32];
    let mut mac_key = [0u8; 32];
    hk.expand(b"enc", &mut enc_key)
        .map_err(|e| CryptoError::Kdf(e.to_string()))?;
    hk.expand(b"mac", &mut mac_key)
        .map_err(|e| CryptoError::Kdf(e.to_string()))?;
    stretched[..32].copy_from_slice(&enc_key);
    stretched[32..].copy_from_slice(&mac_key);
    enc_key.zeroize();
    mac_key.zeroize();
    Ok(stretched)
}

/// The stretched master key as a SymmetricKey (borrows from stretched bytes).
pub fn master_key_to_sym(stretched: &[u8; 64]) -> Result<SymmetricKey, CryptoError> {
    SymmetricKey::from_bytes(stretched)
}

/// The 32-byte master key (output of KDF).
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct MasterKey(pub [u8; 32]);

impl MasterKey {
    /// Stretch and wrap a randomly-generated user symmetric key.
    /// Returns: (UserKey, EncString wrapping the user key)
    pub fn generate_user_key(&self) -> Result<(UserKey, EncString), CryptoError> {
        let stretched = stretch_master_key(&self.0)?;
        let sym = SymmetricKey::from_bytes(&*stretched)?;

        let user_key = UserKey::generate();
        let user_key_enc = EncString::encrypt(&user_key.raw_bytes(), &sym)?;

        Ok((user_key, user_key_enc))
    }

    /// Unwrap an encrypted user key using this master key.
    pub fn decrypt_user_key(&self, enc: &EncString) -> Result<UserKey, CryptoError> {
        let stretched = stretch_master_key(&self.0)?;
        let sym = SymmetricKey::from_bytes(&*stretched)?;
        let raw = enc.decrypt(&sym)?;
        UserKey::from_bytes(&raw)
    }
}

/// A 64-byte user symmetric key (enc + mac).
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct UserKey([u8; 64]);

impl UserKey {
    pub fn generate() -> Self {
        let mut bytes = [0u8; 64];
        rand::thread_rng().fill_bytes(&mut bytes);
        Self(bytes)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        if bytes.len() != 64 {
            return Err(CryptoError::InvalidKeyLength { expected: 64, got: bytes.len() });
        }
        let mut arr = [0u8; 64];
        arr.copy_from_slice(bytes);
        Ok(Self(arr))
    }

    pub fn raw_bytes(&self) -> Vec<u8> {
        self.0.to_vec()
    }

    pub fn to_symmetric_key(&self) -> Result<SymmetricKey, CryptoError> {
        SymmetricKey::from_bytes(&self.0)
    }

    /// Encrypt a vault item field.
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<EncString, CryptoError> {
        let sym = self.to_symmetric_key()?;
        EncString::encrypt(plaintext, &sym)
    }

    /// Decrypt a vault item field.
    pub fn decrypt(&self, enc: &EncString) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
        let sym = self.to_symmetric_key()?;
        enc.decrypt(&sym)
    }
}

/// A 64-byte organization symmetric key.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct OrgKey([u8; 64]);

impl OrgKey {
    pub fn generate() -> Self {
        let mut bytes = [0u8; 64];
        rand::thread_rng().fill_bytes(&mut bytes);
        Self(bytes)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        if bytes.len() != 64 {
            return Err(CryptoError::InvalidKeyLength { expected: 64, got: bytes.len() });
        }
        let mut arr = [0u8; 64];
        arr.copy_from_slice(bytes);
        Ok(Self(arr))
    }

    pub fn raw_bytes(&self) -> Vec<u8> {
        self.0.to_vec()
    }

    pub fn to_symmetric_key(&self) -> Result<SymmetricKey, CryptoError> {
        SymmetricKey::from_bytes(&self.0)
    }

    /// RSA-OAEP-SHA256 encrypt the org key to a member's public key.
    pub fn encrypt_to_member(
        &self,
        public_key_der: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        let pub_key = RsaPublicKey::from_public_key_der(public_key_der)
            .map_err(|e| CryptoError::Rsa(e.to_string()))?;
        let padding = Oaep::new::<Sha256>();
        let mut rng = rand::thread_rng();
        pub_key
            .encrypt(&mut rng, padding, &self.0)
            .map_err(|e| CryptoError::Rsa(e.to_string()))
    }

    /// RSA-OAEP-SHA256 decrypt the org key using a member's private key.
    pub fn decrypt_from_member(
        enc_org_key: &[u8],
        private_key_der: &[u8],
    ) -> Result<Self, CryptoError> {
        let priv_key = RsaPrivateKey::from_pkcs8_der(private_key_der)
            .map_err(|e| CryptoError::Rsa(e.to_string()))?;
        let padding = Oaep::new::<Sha256>();
        let raw = priv_key
            .decrypt(padding, enc_org_key)
            .map_err(|e| CryptoError::Rsa(e.to_string()))?;
        Self::from_bytes(&raw)
    }

    pub fn encrypt(&self, plaintext: &[u8]) -> Result<EncString, CryptoError> {
        let sym = self.to_symmetric_key()?;
        EncString::encrypt(plaintext, &sym)
    }

    pub fn decrypt(&self, enc: &EncString) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
        let sym = self.to_symmetric_key()?;
        enc.decrypt(&sym)
    }
}

/// Generate an RSA-2048 key pair. Returns (DER-encoded private key, DER-encoded public key).
pub fn generate_rsa_key_pair() -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
    let mut rng = rand::thread_rng();
    let priv_key = RsaPrivateKey::new(&mut rng, 2048)
        .map_err(|e| CryptoError::Rsa(e.to_string()))?;
    let pub_key = priv_key.to_public_key();

    let priv_der = priv_key
        .to_pkcs8_der()
        .map_err(|e| CryptoError::Rsa(e.to_string()))?
        .to_bytes()
        .to_vec();
    let pub_der = pub_key
        .to_public_key_der()
        .map_err(|e| CryptoError::Rsa(e.to_string()))?
        .to_vec();

    Ok((priv_der, pub_der))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kdf::{derive_master_key, Kdf, Argon2idParams};

    fn master_key() -> MasterKey {
        let kdf = Kdf::Argon2id(Argon2idParams { m_cost: 8192, t_cost: 1, p_cost: 1 });
        let k = derive_master_key(b"password", "test@example.com", &kdf).unwrap();
        MasterKey(*k)
    }

    #[test]
    fn user_key_roundtrip() {
        let mk = master_key();
        let (user_key, enc_user_key) = mk.generate_user_key().unwrap();
        let decrypted = mk.decrypt_user_key(&enc_user_key).unwrap();
        assert_eq!(user_key.0, decrypted.0);
    }

    #[test]
    fn vault_item_encrypt_decrypt() {
        let mk = master_key();
        let (user_key, _) = mk.generate_user_key().unwrap();
        let plaintext = b"hunter2";
        let enc = user_key.encrypt(plaintext).unwrap();
        let dec = user_key.decrypt(&enc).unwrap();
        assert_eq!(dec.as_slice(), plaintext);
    }

    #[test]
    fn org_key_rsa_roundtrip() {
        let (priv_der, pub_der) = generate_rsa_key_pair().unwrap();
        let org_key = OrgKey::generate();
        let enc = org_key.encrypt_to_member(&pub_der).unwrap();
        let dec = OrgKey::decrypt_from_member(&enc, &priv_der).unwrap();
        assert_eq!(org_key.0, dec.0);
    }
}
