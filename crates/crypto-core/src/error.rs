use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("KDF error: {0}")]
    Kdf(String),

    #[error("Encryption error")]
    Encryption,

    #[error("Decryption error — wrong key or corrupt ciphertext")]
    Decryption,

    #[error("HMAC verification failed")]
    MacMismatch,

    #[error("Invalid EncString format: {0}")]
    InvalidEncString(String),

    #[error("Invalid key length: expected {expected}, got {got}")]
    InvalidKeyLength { expected: usize, got: usize },

    #[error("RSA error: {0}")]
    Rsa(String),

    #[error("Invalid recovery phrase")]
    InvalidRecoveryPhrase,

    #[error("Base64 decode error: {0}")]
    Base64(#[from] base64::DecodeError),

    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}
