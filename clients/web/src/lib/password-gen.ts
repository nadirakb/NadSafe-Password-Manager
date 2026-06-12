export interface PasswordConfig {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
  minUppercase: number;
  minLowercase: number;
  minNumbers: number;
  minSpecial: number;
}

export const DEFAULT_PASSWORD_CONFIG: PasswordConfig = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  avoidAmbiguous: false,
  minUppercase: 1,
  minLowercase: 1,
  minNumbers: 1,
  minSpecial: 1,
};

const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()_+-=[]{}|;:,.<>?";
const AMBIGUOUS = new Set("Il1O0");

function filterAmbiguous(s: string, avoid: boolean): string {
  return avoid ? [...s].filter((c) => !AMBIGUOUS.has(c)).join("") : s;
}

function randomIndex(max: number): number {
  // Rejection sampling — plain modulo skews toward low indices.
  const limit = Math.floor(0x100000000 / max) * max;
  const arr = new Uint32Array(1);
  do {
    crypto.getRandomValues(arr);
  } while (arr[0] >= limit);
  return arr[0] % max;
}

function pickRandom(pool: string): string {
  return pool[randomIndex(pool.length)];
}

export function generatePassword(cfg: PasswordConfig = DEFAULT_PASSWORD_CONFIG): string {
  let charset = "";
  if (cfg.uppercase) charset += filterAmbiguous(UPPERCASE, cfg.avoidAmbiguous);
  if (cfg.lowercase) charset += filterAmbiguous(LOWERCASE, cfg.avoidAmbiguous);
  if (cfg.numbers) charset += filterAmbiguous(DIGITS, cfg.avoidAmbiguous);
  if (cfg.symbols) charset += SYMBOLS;
  if (!charset) throw new Error("No character classes enabled");

  const required: string[] = [];
  if (cfg.uppercase) {
    const pool = filterAmbiguous(UPPERCASE, cfg.avoidAmbiguous);
    for (let i = 0; i < cfg.minUppercase; i++) required.push(pickRandom(pool));
  }
  if (cfg.lowercase) {
    const pool = filterAmbiguous(LOWERCASE, cfg.avoidAmbiguous);
    for (let i = 0; i < cfg.minLowercase; i++) required.push(pickRandom(pool));
  }
  if (cfg.numbers) {
    const pool = filterAmbiguous(DIGITS, cfg.avoidAmbiguous);
    for (let i = 0; i < cfg.minNumbers; i++) required.push(pickRandom(pool));
  }
  if (cfg.symbols) {
    for (let i = 0; i < cfg.minSpecial; i++) required.push(pickRandom(SYMBOLS));
  }

  const chars = [...required];
  while (chars.length < cfg.length) {
    chars.push(pickRandom(charset));
  }

  // Fisher-Yates shuffle using crypto random
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}

/** Estimate password entropy bits. */
export function passwordEntropy(pw: string): number {
  const hasUpper = /[A-Z]/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasDigit = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  let pool = 0;
  if (hasUpper) pool += 26;
  if (hasLower) pool += 26;
  if (hasDigit) pool += 10;
  if (hasSymbol) pool += 32;
  return pool > 0 ? Math.floor(pw.length * Math.log2(pool)) : 0;
}
