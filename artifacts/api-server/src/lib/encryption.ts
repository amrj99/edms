/**
 * AES-256-GCM symmetric encryption for sensitive config values (e.g. S3 credentials).
 *
 * Key source: ENCRYPTION_KEY environment variable — 64-char hex string (32 bytes).
 * If ENCRYPTION_KEY is not set the helpers are transparent no-ops so existing
 * plaintext values in the database continue to work without changes.
 *
 * Encrypted format: "enc:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * Values without the "enc:" prefix are treated as plaintext (backward compatible).
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const ENC_PREFIX = "enc:";

function getKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  if (raw.length !== 64) {
    console.warn("[encryption] ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Encryption disabled.");
    return null;
  }
  return Buffer.from(raw, "hex");
}

/**
 * Encrypt a plaintext string.
 * Returns "enc:<iv>:<authTag>:<ciphertext>" or the original value if no key is set.
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;
  if (plaintext.startsWith(ENC_PREFIX)) return plaintext; // Already encrypted

  const key = getKey();
  if (!key) return plaintext; // No-op when key not configured

  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt an encrypted string produced by `encrypt()`.
 * Returns the original plaintext. If the value has no "enc:" prefix it is
 * returned unchanged (backward compatible with plaintext values already in DB).
 */
export function decrypt(value: string): string {
  if (!value) return value;
  if (!value.startsWith(ENC_PREFIX)) return value; // Plaintext — backward compat

  const key = getKey();
  if (!key) {
    console.warn("[encryption] Encrypted value found but ENCRYPTION_KEY is not set — returning raw value.");
    return value; // Return encrypted string as-is rather than crashing
  }

  const parts = value.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("[encryption] Malformed encrypted value");

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Generate a new random 256-bit key suitable for ENCRYPTION_KEY.
 * Run once during setup and store the output in the environment secret.
 */
export function generateKey(): string {
  return crypto.randomBytes(32).toString("hex");
}
