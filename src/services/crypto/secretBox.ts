import * as crypto from "crypto";

// Authenticated symmetric encryption for secrets that must be recoverable
// (unlike API keys, which are one-way bcrypt hashes). AES-256-GCM detects
// tampering via its auth tag, so a corrupted or forged ciphertext throws on
// decrypt rather than returning garbage.

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256
const VERSION = "v1";

function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  return key;
}

/**
 * Validates that ENCRYPTION_KEY is present and well-formed. Call at startup to
 * fail closed before any request can reach the encryption path.
 */
export function assertEncryptionKey(): void {
  loadKey();
}

/**
 * Encrypts a plaintext secret. Returns a self-describing string
 * `v1:<iv>:<authTag>:<ciphertext>` (each part base64). A fresh random IV per
 * call means the same plaintext never encrypts to the same ciphertext.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, loadKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a string produced by {@link encryptSecret}. Throws if the payload
 * is malformed, was encrypted with a different key, or has been tampered with.
 */
export function decryptSecret(encoded: string): string {
  const [version, ivB64, tagB64, dataB64] = encoded.split(":");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted secret");
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    loadKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
