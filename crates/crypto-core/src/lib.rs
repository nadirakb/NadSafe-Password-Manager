pub mod enc_string;
pub mod error;
pub mod kdf;
pub mod keys;
pub mod password_gen;
pub mod recovery;
pub mod totp;

pub use enc_string::EncString;
pub use error::CryptoError;
pub use kdf::{Kdf, KdfParams};
pub use keys::{stretch_master_key, MasterKey, OrgKey, UserKey};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
