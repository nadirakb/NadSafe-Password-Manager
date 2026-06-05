use nadsafe_crypto_core::{
    kdf::{derive_master_key as kdf_derive, Kdf, Argon2idParams},
    keys::MasterKey,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct DeriveKeyRequest {
    pub password: String,
    pub email: String,
    pub m_cost: Option<u32>,
    pub t_cost: Option<u32>,
    pub p_cost: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct GenerateUserKeyResponse {
    /// Base64-encoded encrypted user key (to send to server).
    pub encrypted_user_key: String,
}

#[tauri::command]
pub async fn derive_master_key(req: DeriveKeyRequest) -> Result<String, String> {
    let kdf = Kdf::Argon2id(Argon2idParams {
        m_cost: req.m_cost.unwrap_or(65536),
        t_cost: req.t_cost.unwrap_or(3),
        p_cost: req.p_cost.unwrap_or(4),
    });
    kdf_derive(req.password.as_bytes(), &req.email, &kdf)
        .map(|k| base64::encode(*k))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_user_key(master_key_b64: String) -> Result<GenerateUserKeyResponse, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&master_key_b64)
        .map_err(|e| e.to_string())?;
    if bytes.len() != 32 {
        return Err("master key must be 32 bytes".into());
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    let mk = MasterKey(arr);
    let (_user_key, enc) = mk.generate_user_key().map_err(|e| e.to_string())?;
    Ok(GenerateUserKeyResponse { encrypted_user_key: enc.to_string() })
}
