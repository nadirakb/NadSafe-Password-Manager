//! Password and passphrase generator.

use rand::RngCore;
use rand::seq::SliceRandom;

const UPPERCASE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const DIGITS: &[u8] = b"0123456789";
const SYMBOLS: &[u8] = b"!@#$%^&*()_+-=[]{}|;:,.<>?";
const AMBIGUOUS: &[u8] = b"Il1O0";

#[derive(Debug, Clone)]
pub struct PasswordConfig {
    pub length: usize,
    pub uppercase: bool,
    pub lowercase: bool,
    pub numbers: bool,
    pub symbols: bool,
    pub avoid_ambiguous: bool,
    pub min_uppercase: usize,
    pub min_lowercase: usize,
    pub min_numbers: usize,
    pub min_special: usize,
}

impl Default for PasswordConfig {
    fn default() -> Self {
        Self {
            length: 20,
            uppercase: true,
            lowercase: true,
            numbers: true,
            symbols: true,
            avoid_ambiguous: false,
            min_uppercase: 1,
            min_lowercase: 1,
            min_numbers: 1,
            min_special: 1,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum GenError {
    #[error("no character classes enabled")]
    NoCharset,
    #[error("length {0} too short for minimum requirements")]
    TooShort(usize),
}

/// Generate a random password matching the given config.
pub fn generate_password(cfg: &PasswordConfig) -> Result<String, GenError> {
    let mut rng = rand::thread_rng();

    let mut charset: Vec<u8> = Vec::new();
    if cfg.uppercase {
        charset.extend(filter_ambiguous(UPPERCASE, cfg.avoid_ambiguous));
    }
    if cfg.lowercase {
        charset.extend(filter_ambiguous(LOWERCASE, cfg.avoid_ambiguous));
    }
    if cfg.numbers {
        charset.extend(filter_ambiguous(DIGITS, cfg.avoid_ambiguous));
    }
    if cfg.symbols {
        charset.extend(SYMBOLS);
    }
    if charset.is_empty() {
        return Err(GenError::NoCharset);
    }

    let min_total = cfg.min_uppercase + cfg.min_lowercase + cfg.min_numbers + cfg.min_special;
    if cfg.length < min_total {
        return Err(GenError::TooShort(cfg.length));
    }

    // Build required characters first, then fill the rest randomly.
    let mut required: Vec<u8> = Vec::new();

    let push_required = |pool: &[u8], count: usize, buf: &mut Vec<u8>, rng: &mut rand::rngs::ThreadRng| {
        let pool = filter_ambiguous(pool, cfg.avoid_ambiguous);
        for _ in 0..count {
            if !pool.is_empty() {
                let idx = random_usize(rng, pool.len());
                buf.push(pool[idx]);
            }
        }
    };

    if cfg.uppercase {
        push_required(UPPERCASE, cfg.min_uppercase, &mut required, &mut rng);
    }
    if cfg.lowercase {
        push_required(LOWERCASE, cfg.min_lowercase, &mut required, &mut rng);
    }
    if cfg.numbers {
        push_required(DIGITS, cfg.min_numbers, &mut required, &mut rng);
    }
    if cfg.symbols {
        push_required(SYMBOLS, cfg.min_special, &mut required, &mut rng);
    }

    // Fill remainder from full charset.
    let mut password = required;
    while password.len() < cfg.length {
        let idx = random_usize(&mut rng, charset.len());
        password.push(charset[idx]);
    }

    // Shuffle so required chars aren't always at the start.
    password.shuffle(&mut rng);

    Ok(String::from_utf8(password).expect("charset is ASCII"))
}

fn filter_ambiguous(pool: &[u8], avoid: bool) -> Vec<u8> {
    if !avoid {
        return pool.to_vec();
    }
    pool.iter().copied().filter(|b| !AMBIGUOUS.contains(b)).collect()
}

fn random_usize(rng: &mut rand::rngs::ThreadRng, max: usize) -> usize {
    let mut buf = [0u8; 4];
    rng.fill_bytes(&mut buf);
    (u32::from_le_bytes(buf) as usize) % max
}

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn generate_password_wasm(
    length: usize,
    uppercase: bool,
    lowercase: bool,
    numbers: bool,
    symbols: bool,
    avoid_ambiguous: bool,
) -> Result<String, String> {
    generate_password(&PasswordConfig {
        length,
        uppercase,
        lowercase,
        numbers,
        symbols,
        avoid_ambiguous,
        min_uppercase: if uppercase { 1 } else { 0 },
        min_lowercase: if lowercase { 1 } else { 0 },
        min_numbers: if numbers { 1 } else { 0 },
        min_special: if symbols { 1 } else { 0 },
    })
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_generates_password() {
        let pw = generate_password(&PasswordConfig::default()).unwrap();
        assert_eq!(pw.len(), 20);
    }

    #[test]
    fn respects_length() {
        for len in [8, 16, 32, 64] {
            let pw = generate_password(&PasswordConfig { length: len, ..Default::default() }).unwrap();
            assert_eq!(pw.len(), len);
        }
    }

    #[test]
    fn uppercase_only() {
        let pw = generate_password(&PasswordConfig {
            length: 20, uppercase: true, lowercase: false, numbers: false, symbols: false,
            avoid_ambiguous: false, min_uppercase: 1, min_lowercase: 0, min_numbers: 0, min_special: 0,
        }).unwrap();
        assert!(pw.chars().all(|c| c.is_uppercase()));
    }

    #[test]
    fn no_ambiguous() {
        let pw = generate_password(&PasswordConfig {
            length: 100, avoid_ambiguous: true, ..Default::default()
        }).unwrap();
        for ch in AMBIGUOUS {
            assert!(!pw.contains(*ch as char), "found ambiguous char {}", *ch as char);
        }
    }

    #[test]
    fn uniqueness() {
        let a = generate_password(&PasswordConfig::default()).unwrap();
        let b = generate_password(&PasswordConfig::default()).unwrap();
        // Astronomically unlikely to collide
        assert_ne!(a, b);
    }
}
