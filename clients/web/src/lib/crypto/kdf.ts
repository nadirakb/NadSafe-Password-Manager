/**
 * KDF layer — browser implementation using WebCrypto (PBKDF2) and hash-wasm (Argon2id).
 * In Tauri desktop context, Argon2id is offloaded to the native Rust command to avoid
 * the WASM CSP restriction on Tauri's webview.
 * Matches the Bitwarden key derivation spec exactly.
 */

import { argon2id } from "hash-wasm";
import { toUtf8 } from "./utils";
import type { KdfParams } from "./types";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Derive the 32-byte master key from master password and email.
 * Email is lowercased and used as salt (Bitwarden spec).
 */
export async function deriveMasterKey(
  password: string,
  email: string,
  params: KdfParams,
): Promise<Uint8Array> {
  const passwordBytes = toUtf8(password);
  const salt = toUtf8(email.toLowerCase());

  if (params.type === "argon2id") {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      const b64 = await invoke<string>("derive_master_key", {
        req: {
          password,
          email,
          m_cost: params.mCost,
          t_cost: params.tCost,
          p_cost: params.pCost,
        },
      });
      const binary = atob(b64);
      return Uint8Array.from(binary, (c) => c.charCodeAt(0));
    }

    return argon2id({
      password: passwordBytes,
      salt,
      parallelism: params.pCost,
      iterations: params.tCost,
      memorySize: params.mCost,
      hashLength: 32,
      outputType: "binary",
    });
  }

  // PBKDF2-HMAC-SHA256
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(passwordBytes),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new Uint8Array(salt),
      iterations: params.iterations,
    },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * Derive the server-auth hash: PBKDF2(masterKey, password, 1).
 * This is what the server stores — it cannot decrypt the vault.
 */
export async function deriveAuthHash(
  masterKey: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(masterKey),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new Uint8Array(toUtf8(password)),
      iterations: 1,
    },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * HKDF-Expand the master key into a 64-byte stretched key (enc + mac).
 * Uses master key directly as PRK (Bitwarden skips the extract phase).
 */
export async function stretchMasterKey(
  masterKey: Uint8Array,
): Promise<{ encKey: Uint8Array; macKey: Uint8Array }> {
  const prk = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(masterKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const encKey = new Uint8Array(await hkdfExpand(prk, "enc", 32));
  const macKey = new Uint8Array(await hkdfExpand(prk, "mac", 32));

  return { encKey, macKey };
}

/**
 * HKDF-Expand (single block, outputLen ≤ 32 for SHA-256).
 * T(1) = HMAC-SHA256(PRK, info || 0x01)
 */
async function hkdfExpand(
  prk: CryptoKey,
  info: string,
  outputLen: number,
): Promise<ArrayBuffer> {
  const infoBytes = toUtf8(info);
  const message = new Uint8Array(infoBytes.length + 1);
  message.set(infoBytes);
  message[infoBytes.length] = 0x01;
  const mac = await crypto.subtle.sign("HMAC", prk, message);
  return mac.slice(0, outputLen);
}
