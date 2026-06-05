/**
 * RFC 6238 TOTP — browser implementation using WebCrypto HMAC-SHA1.
 */

const PERIOD = 30;
const DIGITS = 6;

function base32Decode(input: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const s = input.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  const out: number[] = [];
  let bits = 0;
  let bitCount = 0;
  for (const ch of s) {
    const val = alphabet.indexOf(ch);
    if (val === -1) throw new Error(`Invalid base32 character: ${ch}`);
    bits = (bits << 5) | val;
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      out.push((bits >> bitCount) & 0xff);
      bits &= (1 << bitCount) - 1;
    }
  }
  return new Uint8Array(out);
}

/** Generate a TOTP code for the given base32 secret and Unix timestamp. */
export async function generateTotp(
  secretB32: string,
  timestampSecs: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const secret = base32Decode(secretB32);
  const counter = Math.floor(timestampSecs / PERIOD);

  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  // Write 64-bit big-endian counter (JS safe integer: high 32 bits are 0)
  view.setUint32(0, 0, false);
  view.setUint32(4, counter >>> 0, false);

  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBuf));

  const offset = mac[19] & 0x0f;
  const code =
    (((mac[offset] & 0x7f) << 24) |
      ((mac[offset + 1] & 0xff) << 16) |
      ((mac[offset + 2] & 0xff) << 8) |
      (mac[offset + 3] & 0xff)) %
    10 ** DIGITS;

  return code.toString().padStart(DIGITS, "0");
}

/** Seconds remaining in current TOTP window. */
export function totpSecondsRemaining(timestampSecs: number = Math.floor(Date.now() / 1000)): number {
  return PERIOD - (timestampSecs % PERIOD);
}
