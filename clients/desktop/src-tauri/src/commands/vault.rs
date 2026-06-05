use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use nadsafe_crypto_core::{
    kdf::{derive_master_key as kdf_derive, Argon2idParams, Kdf},
    keys::MasterKey,
    password_gen::{generate_password as gen_pw, PasswordConfig},
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

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
    pub encrypted_user_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PasswordGenRequest {
    pub length: usize,
    pub uppercase: bool,
    pub lowercase: bool,
    pub numbers: bool,
    pub symbols: bool,
    pub avoid_ambiguous: bool,
}

#[tauri::command]
pub async fn derive_master_key(req: DeriveKeyRequest) -> Result<String, String> {
    let kdf = Kdf::Argon2id(Argon2idParams {
        m_cost: req.m_cost.unwrap_or(65536),
        t_cost: req.t_cost.unwrap_or(3),
        p_cost: req.p_cost.unwrap_or(4),
    });
    kdf_derive(req.password.as_bytes(), &req.email, &kdf)
        .map(|k| B64.encode(*k))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_user_key(master_key_b64: String) -> Result<GenerateUserKeyResponse, String> {
    let bytes = B64.decode(&master_key_b64).map_err(|e| e.to_string())?;
    if bytes.len() != 32 {
        return Err("master key must be 32 bytes".into());
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    let mk = MasterKey(arr);
    let (_user_key, enc) = mk.generate_user_key().map_err(|e| e.to_string())?;
    Ok(GenerateUserKeyResponse { encrypted_user_key: enc.to_string() })
}

#[tauri::command]
pub async fn generate_password(req: PasswordGenRequest) -> Result<String, String> {
    let cfg = PasswordConfig {
        length: req.length,
        uppercase: req.uppercase,
        lowercase: req.lowercase,
        numbers: req.numbers,
        symbols: req.symbols,
        avoid_ambiguous: req.avoid_ambiguous,
        min_uppercase: if req.uppercase { 1 } else { 0 },
        min_lowercase: if req.lowercase { 1 } else { 0 },
        min_numbers: if req.numbers { 1 } else { 0 },
        min_special: if req.symbols { 1 } else { 0 },
    };
    gen_pw(&cfg).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lock_vault(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.emit("vault:lock", ()).map_err(|e| e.to_string())?;
    }
    Ok(())
}
