//! Conformance tests against known Bitwarden crypto vectors.
//!
//! Reference values computed from PBKDF2-HMAC-SHA256 (Python hashlib) and
//! HKDF-SHA256 manual expand with info="enc"/"mac" — identical algorithm used by
//! Bitwarden jslib `stretchKey()` and by our Rust implementation.
//!
//! Test data sourced from:
//! - Bitwarden jslib / sdk test fixtures
//! - https://github.com/bitwarden/sdk (Apache-2.0 / GPL-3.0)
//! - Reference Python implementation cross-validated against openssl CLI
//!
//! These tests ensure NadSafe crypto is wire-compatible with Vaultwarden/Bitwarden.

use nadsafe_crypto_core::{
    enc_string::{EncString, SymmetricKey},
    kdf::{derive_auth_hash, derive_master_key, Kdf, Pbkdf2Params},
    keys::{stretch_master_key, MasterKey},
};

// ── PBKDF2 KDF Vectors ──────────────────────────────────────────────────────

/// PBKDF2-SHA256, 5000 iter (legacy compatibility vector).
/// password = "masterpassword", email = "user@example.com"
/// Reference: Python hashlib.pbkdf2_hmac('sha256', b'masterpassword', b'user@example.com', 5000)
#[test]
fn pbkdf2_5k_master_key_vector() {
    let kdf = Kdf::Pbkdf2(Pbkdf2Params { iterations: 5000 });
    let key = derive_master_key(b"masterpassword", "user@example.com", &kdf).unwrap();
    let expected = hex::decode("562289f6883d1e80113da9767e2d2ecb611bec4e29ab5b3adf46cae7237f537c").unwrap();
    assert_eq!(key.as_ref(), expected.as_slice(), "PBKDF2-5k master key mismatch");
}

/// PBKDF2-SHA256, 600000 iter (current Bitwarden default).
/// password = "password", email = "user@example.com"
#[test]
fn pbkdf2_600k_master_key_vector() {
    let kdf = Kdf::Pbkdf2(Pbkdf2Params { iterations: 600_000 });
    let key = derive_master_key(b"password", "user@example.com", &kdf).unwrap();
    let expected = hex::decode("81be19a9c170df7152970ab88d3bef6de90595ed232b873a876869d68a780d68").unwrap();
    assert_eq!(key.as_ref(), expected.as_slice(), "PBKDF2-600k master key mismatch");
}

// ── Auth Hash Vectors ────────────────────────────────────────────────────────

/// Auth hash = PBKDF2(master_key, master_password, 1).
/// Verified against Python reference: hashlib.pbkdf2_hmac('sha256', master_key, b'masterpassword', 1)
#[test]
fn pbkdf2_5k_auth_hash_vector() {
    let kdf = Kdf::Pbkdf2(Pbkdf2Params { iterations: 5000 });
    let master_key = derive_master_key(b"masterpassword", "user@example.com", &kdf).unwrap();
    let auth_hash = derive_auth_hash(&master_key, b"masterpassword");
    let expected = hex::decode("76a315a2dfeca6addebd64dbb4eff6ca43b3e7ec7ac3689a2e0e776b044ed3aa").unwrap();
    assert_eq!(auth_hash.as_ref(), expected.as_slice(), "Auth hash (5k) mismatch");
}

/// Auth hash for 600k PBKDF2.
#[test]
fn pbkdf2_600k_auth_hash_vector() {
    let kdf = Kdf::Pbkdf2(Pbkdf2Params { iterations: 600_000 });
    let master_key = derive_master_key(b"password", "user@example.com", &kdf).unwrap();
    let auth_hash = derive_auth_hash(&master_key, b"password");
    let expected = hex::decode("8c6072f953c004c637cbe3dd56063b8c296cc90847786470bd8152fa5ea37c7f").unwrap();
    assert_eq!(auth_hash.as_ref(), expected.as_slice(), "Auth hash (600k) mismatch");
}

/// Auth hash must differ from master key (different domain separation).
#[test]
fn auth_hash_differs_from_master_key() {
    let kdf = Kdf::Pbkdf2(Pbkdf2Params { iterations: 600_000 });
    let master_key = derive_master_key(b"password", "user@example.com", &kdf).unwrap();
    let auth_hash = derive_auth_hash(&master_key, b"password");
    assert_ne!(*master_key, auth_hash, "auth hash must differ from master key");
}

// ── HKDF Stretch Vectors ─────────────────────────────────────────────────────

/// HKDF stretch from PBKDF2-5k master key.
/// Reference: HKDF-SHA256 from_prk(master_key).expand("enc") + expand("mac")
/// Cross-validated against Python hkdf_expand(prk, b"enc", 32) || hkdf_expand(prk, b"mac", 32)
#[test]
fn hkdf_stretch_5k_vector() {
    let kdf = Kdf::Pbkdf2(Pbkdf2Params { iterations: 5000 });
    let master_key = derive_master_key(b"masterpassword", "user@example.com", &kdf).unwrap();
    let stretched = stretch_master_key(&master_key).unwrap();

    let expected_enc = hex::decode("142d9e9fb476c290fa5454e301756662b813edccf26420852983dc9f20b33853").unwrap();
    let expected_mac = hex::decode("1ea9fd1675992d9ccbbf5eead0bb45b8f044415bbe018130f483e3ee84624804").unwrap();
    assert_eq!(&stretched[..32], expected_enc.as_slice(), "enc_key mismatch");
    assert_eq!(&stretched[32..], expected_mac.as_slice(), "mac_key mismatch");
}

/// HKDF stretch from PBKDF2-600k master key.
#[test]
fn hkdf_stretch_600k_vector() {
    let kdf = Kdf::Pbkdf2(Pbkdf2Params { iterations: 600_000 });
    let master_key = derive_master_key(b"password", "user@example.com", &kdf).unwrap();
    let stretched = stretch_master_key(&master_key).unwrap();

    let expected_enc = hex::decode("4cd5a5f1b6326bd572de7c07a7e5674d013e404cc32077ef8f5eb4d2f5364759").unwrap();
    let expected_mac = hex::decode("099fa1ff37a68dda11b0de6c10d3007e3c6d0f9fcf2b6c32154a45a0e1317538").unwrap();
    assert_eq!(&stretched[..32], expected_enc.as_slice(), "enc_key mismatch");
    assert_eq!(&stretched[32..], expected_mac.as_slice(), "mac_key mismatch");
}

/// Stretch output is 64 bytes and enc / mac halves differ.
#[test]
fn hkdf_stretch_produces_64_bytes() {
    let kdf = Kdf::Pbkdf2(Pbkdf2Params { iterations: 1 }); // fast for test
    let master_key = derive_master_key(b"pw", "a@b.com", &kdf).unwrap();
    let stretched = stretch_master_key(&master_key).unwrap();
    assert_eq!(stretched.len(), 64);
    assert_ne!(&stretched[..32], &stretched[32..], "enc and mac halves must differ");
}

// ── EncString Format Conformance ─────────────────────────────────────────────

/// EncString round-trip: encrypt → serialize → parse → decrypt.
/// Serialization must match Bitwarden wire format: "2.{iv_b64}|{ct_b64}|{mac_b64}"
#[test]
fn enc_string_type2_roundtrip() {
    let sym = SymmetricKey {
        enc_key: [0x11u8; 32],
        mac_key: [0x22u8; 32],
    };
    let plaintext = b"correct horse battery staple";
    let enc = EncString::encrypt(plaintext, &sym).unwrap();

    let s = enc.to_string();
    assert!(s.starts_with("2."), "EncString must start with type '2.'");
    let parts: Vec<&str> = s.split('|').collect();
    assert_eq!(parts.len(), 3, "EncString must have 3 pipe-separated parts");

    // IV segment must be base64 of exactly 16 bytes → 24 base64 chars
    let iv_b64 = parts[0].trim_start_matches("2.");
    let iv_decoded = base64::engine::Engine::decode(
        &base64::engine::general_purpose::STANDARD, iv_b64
    ).unwrap();
    assert_eq!(iv_decoded.len(), 16, "IV must be 16 bytes");

    // MAC segment must be base64 of exactly 32 bytes → 44 base64 chars
    let mac_decoded = base64::engine::Engine::decode(
        &base64::engine::general_purpose::STANDARD, parts[2]
    ).unwrap();
    assert_eq!(mac_decoded.len(), 32, "MAC must be 32 bytes");

    // Full parse + decrypt round-trip
    let parsed = EncString::parse(&s).unwrap();
    let dec = parsed.decrypt(&sym).unwrap();
    assert_eq!(dec.as_slice(), plaintext);
}

/// EncString encrypted with known key should be AES-256-CBC + HMAC-SHA256 verifiable.
/// The ciphertext must change between calls (random IV) but always decrypt correctly.
#[test]
fn enc_string_random_iv_each_call() {
    let sym = SymmetricKey {
        enc_key: [0xDEu8; 32],
        mac_key: [0xADu8; 32],
    };
    let pt = b"same plaintext";
    let enc1 = EncString::encrypt(pt, &sym).unwrap().to_string();
    let enc2 = EncString::encrypt(pt, &sym).unwrap().to_string();
    assert_ne!(enc1, enc2, "random IV must produce different ciphertexts");
    // Both must decrypt to same plaintext
    let dec1 = EncString::parse(&enc1).unwrap().decrypt(&sym).unwrap();
    let dec2 = EncString::parse(&enc2).unwrap().decrypt(&sym).unwrap();
    assert_eq!(dec1.as_slice(), pt);
    assert_eq!(dec2.as_slice(), pt);
}

// ── Key Wrap / Unwrap ────────────────────────────────────────────────────────

/// User key wrap/unwrap: master → stretched → encrypt random user key → decrypt → same bytes.
#[test]
fn user_key_wrap_unwrap_cycle() {
    let kdf = Kdf::Pbkdf2(Pbkdf2Params { iterations: 1 });
    let raw = derive_master_key(b"hunter2", "bob@example.com", &kdf).unwrap();
    let mk = MasterKey(*raw);
    let (user_key, enc_user_key) = mk.generate_user_key().unwrap();
    let recovered = mk.decrypt_user_key(&enc_user_key).unwrap();
    assert_eq!(user_key.raw_bytes(), recovered.raw_bytes(), "user key must survive wrap/unwrap");
}

/// User key must be 64 bytes (32 enc + 32 mac).
#[test]
fn user_key_is_64_bytes() {
    let kdf = Kdf::Pbkdf2(Pbkdf2Params { iterations: 1 });
    let raw = derive_master_key(b"pw", "x@y.com", &kdf).unwrap();
    let mk = MasterKey(*raw);
    let (user_key, _) = mk.generate_user_key().unwrap();
    assert_eq!(user_key.raw_bytes().len(), 64, "user key must be 64 bytes");
}

/// Vault item encrypted with user key must decrypt correctly — field-level encryption.
#[test]
fn vault_item_encrypt_decrypt() {
    let kdf = Kdf::Pbkdf2(Pbkdf2Params { iterations: 1 });
    let raw = derive_master_key(b"pw", "x@y.com", &kdf).unwrap();
    let mk = MasterKey(*raw);
    let (user_key, _) = mk.generate_user_key().unwrap();

    let items: &[&[u8]] = &[
        b"username",
        b"https://github.com",
        b"s3cr3t!",
        b"",  // empty field must round-trip
        &[0xFF; 1024],  // large binary
    ];
    for item in items {
        let enc = user_key.encrypt(item).unwrap();
        let dec = user_key.decrypt(&enc).unwrap();
        assert_eq!(dec.as_slice(), *item, "vault field failed round-trip");
    }
}

// ── MAC / Integrity ──────────────────────────────────────────────────────────

/// Single-bit MAC tamper must be detected regardless of position.
#[test]
fn tampered_mac_rejected() {
    let sym = SymmetricKey {
        enc_key: [0xAAu8; 32],
        mac_key: [0xBBu8; 32],
    };
    let mut enc = EncString::encrypt(b"secret", &sym).unwrap();
    for bit_pos in [0, 7, 15, 16, 31] {
        enc.mac[bit_pos] ^= 0x01;
        assert!(
            enc.decrypt(&sym).is_err(),
            "tampered MAC at byte {bit_pos} must be rejected"
        );
        enc.mac[bit_pos] ^= 0x01; // restore
    }
}

/// Single-byte ciphertext tamper must be detected via MAC.
#[test]
fn tampered_ciphertext_rejected() {
    let sym = SymmetricKey {
        enc_key: [0xCCu8; 32],
        mac_key: [0xDDu8; 32],
    };
    let mut enc = EncString::encrypt(b"hunter2", &sym).unwrap();
    enc.ct[0] ^= 0xFF;
    assert!(
        enc.decrypt(&sym).is_err(),
        "tampered ciphertext must be rejected by MAC"
    );
}

/// Wrong key must fail decryption (MAC mismatch).
#[test]
fn wrong_key_rejected() {
    let sym = SymmetricKey {
        enc_key: [0x11u8; 32],
        mac_key: [0x22u8; 32],
    };
    let bad_sym = SymmetricKey {
        enc_key: [0x99u8; 32],
        mac_key: [0x88u8; 32],
    };
    let enc = EncString::encrypt(b"secret", &sym).unwrap();
    assert!(
        enc.decrypt(&bad_sym).is_err(),
        "wrong key must be rejected"
    );
}

// ── Email Case Normalization ─────────────────────────────────────────────────

/// Email must be lowercased before use as KDF salt (Bitwarden spec requirement).
#[test]
fn kdf_email_case_normalized() {
    let kdf = Kdf::Pbkdf2(Pbkdf2Params { iterations: 5000 });
    let k1 = derive_master_key(b"masterpassword", "User@Example.COM", &kdf).unwrap();
    let k2 = derive_master_key(b"masterpassword", "user@example.com", &kdf).unwrap();
    assert_eq!(*k1, *k2, "email must be normalized to lowercase before KDF");
}
