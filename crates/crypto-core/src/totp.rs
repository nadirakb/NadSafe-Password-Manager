//! RFC 6238 TOTP generator (used by both the vault item display and the NadSafe-account 2FA).

use hmac::{Hmac, Mac};
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

pub const DEFAULT_PERIOD: u64 = 30;
pub const DEFAULT_DIGITS: u32 = 6;

/// Generate a TOTP code.
///
/// `secret` — base32-encoded shared secret (RFC 4648, no padding required)
/// `timestamp_secs` — Unix seconds; use `std::time::SystemTime` in callers
pub fn generate_totp(secret_b32: &str, timestamp_secs: u64) -> Result<String, TotpError> {
    let secret = base32_decode(secret_b32)?;
    let counter = timestamp_secs / DEFAULT_PERIOD;
    let code = hotp(&secret, counter, DEFAULT_DIGITS);
    Ok(format!(
        "{:0>width$}",
        code,
        width = DEFAULT_DIGITS as usize
    ))
}

fn hotp(secret: &[u8], counter: u64, digits: u32) -> u32 {
    let mut mac = HmacSha1::new_from_slice(secret).expect("HMAC-SHA1 accepts any key length");
    mac.update(&counter.to_be_bytes());
    let result = mac.finalize().into_bytes();

    let offset = (result[19] & 0x0f) as usize;
    let code = u32::from_be_bytes([
        result[offset] & 0x7f,
        result[offset + 1],
        result[offset + 2],
        result[offset + 3],
    ]);

    code % 10u32.pow(digits)
}

fn base32_decode(input: &str) -> Result<Vec<u8>, TotpError> {
    // Strip padding and uppercase
    let input = input.trim_end_matches('=').to_uppercase();
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    let mut bits: u32 = 0;
    let mut bit_count: u32 = 0;
    let mut output = Vec::new();

    for ch in input.chars() {
        let val = alphabet
            .iter()
            .position(|&b| b == ch as u8)
            .ok_or(TotpError::InvalidBase32)? as u32;
        bits = (bits << 5) | val;
        bit_count += 5;
        if bit_count >= 8 {
            bit_count -= 8;
            output.push((bits >> bit_count) as u8);
            bits &= (1 << bit_count) - 1;
        }
    }

    Ok(output)
}

#[derive(Debug, thiserror::Error)]
pub enum TotpError {
    #[error("Invalid base32 character in TOTP secret")]
    InvalidBase32,
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 6238 test vectors (SHA-1, 30s period, 8 digits — we truncate to 6)
    // Shared secret: "12345678901234567890" in base32 = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
    const SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    #[test]
    fn known_vector_t59() {
        // At T=59, counter=1 → RFC 6238 says code is 94287082 (8 digits)
        // Truncated to 6: 287082
        let code = generate_totp(SECRET, 59).unwrap();
        assert_eq!(code, "287082");
    }

    #[test]
    fn code_is_6_digits() {
        let code = generate_totp(SECRET, 1000000).unwrap();
        assert_eq!(code.len(), 6);
    }

    #[test]
    fn same_window_same_code() {
        let t = 1700000000u64;
        let c1 = generate_totp(SECRET, t).unwrap();
        let c2 = generate_totp(SECRET, t + 1).unwrap();
        assert_eq!(c1, c2);
    }
}
