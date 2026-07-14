import * as crypto from "crypto";

// Authenticated symmetric encryption for secrets that must be recoverable
// (unlike API keys, which are one-way bcrypt hashes). AES-256-GCM detects
// tampering via its auth tag, so a corrupted or forged ciphertext throws on
// decrypt rather than returning garbage.
//
// Keys are managed as a keyring so the encryption key can be rotated without
// stranding existing ciphertexts: encryption always uses the primary key and
// stamps its id into the payload (v2:<keyId>:...); decryption looks the key up
// by id. Rotating = add a new primary while keeping old keys in the ring.
//
// Configuration (checked in this order):
//   ENCRYPTION_KEYS="<id>:<base64key>,<id>:<base64key>" + ENCRYPTION_PRIMARY_KEY_ID
//   ENCRYPTION_KEY="<base64key>"   (single-key fallback, id "default")

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256
const DEFAULT_KEY_ID = "default";
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

type Keyring = {
  keys: Map<string, Buffer>;
  primaryId: string;
};

function decodeKey(id: string, raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `Encryption key '${id}' must decode to ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  return key;
}

function loadKeyring(): Keyring {
  const rawKeys = process.env.ENCRYPTION_KEYS;
  if (rawKeys && rawKeys.trim()) {
    const keys = new Map<string, Buffer>();
    for (const entry of rawKeys.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const sep = trimmed.indexOf(":");
      if (sep === -1) {
        throw new Error("ENCRYPTION_KEYS entries must be '<id>:<base64key>'");
      }
      const id = trimmed.slice(0, sep);
      if (!KEY_ID_PATTERN.test(id)) {
        throw new Error(
          `Invalid encryption key id '${id}' (allowed: A-Z a-z 0-9 _ -)`,
        );
      }
      keys.set(id, decodeKey(id, trimmed.slice(sep + 1)));
    }
    if (keys.size === 0) {
      throw new Error("ENCRYPTION_KEYS is empty");
    }
    const primaryId = process.env.ENCRYPTION_PRIMARY_KEY_ID;
    if (!primaryId) {
      throw new Error(
        "ENCRYPTION_PRIMARY_KEY_ID is not set (must name a key in ENCRYPTION_KEYS)",
      );
    }
    if (!keys.has(primaryId)) {
      throw new Error(
        `ENCRYPTION_PRIMARY_KEY_ID '${primaryId}' is not present in the keyring`,
      );
    }
    return { keys, primaryId };
  }

  const single = process.env.ENCRYPTION_KEY;
  if (single) {
    return {
      keys: new Map([[DEFAULT_KEY_ID, decodeKey(DEFAULT_KEY_ID, single)]]),
      primaryId: DEFAULT_KEY_ID,
    };
  }

  throw new Error(
    "No encryption key configured: set ENCRYPTION_KEYS or ENCRYPTION_KEY",
  );
}

/**
 * Validates that the keyring is present and well-formed. Call at startup to
 * fail closed before any request can reach the encryption path.
 */
export function assertEncryptionKey(): void {
  loadKeyring();
}

function decryptWith(
  key: Buffer,
  ivB64: string,
  tagB64: string,
  dataB64: string,
): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Encrypts a plaintext secret with the primary key. Returns a self-describing
 * string `v2:<keyId>:<iv>:<authTag>:<ciphertext>` (each part base64). A fresh
 * random IV per call means the same plaintext never encrypts identically.
 */
export function encryptSecret(plaintext: string): string {
  const { keys, primaryId } = loadKeyring();
  const key = keys.get(primaryId) as Buffer;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    "v2",
    primaryId,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a string produced by {@link encryptSecret}, or a legacy v1 payload.
 * Throws if the payload is malformed, its key is not in the keyring, or it has
 * been tampered with.
 */
export function decryptSecret(encoded: string): string {
  const parts = encoded.split(":");
  const { keys } = loadKeyring();

  if (parts[0] === "v2") {
    const [, keyId, ivB64, tagB64, dataB64] = parts;
    if (!keyId || !ivB64 || !tagB64 || !dataB64) {
      throw new Error("Malformed encrypted secret");
    }
    const key = keys.get(keyId);
    if (!key) {
      throw new Error(`Encryption key '${keyId}' is not in the keyring`);
    }
    return decryptWith(key, ivB64, tagB64, dataB64);
  }

  if (parts[0] === "v1") {
    const [, ivB64, tagB64, dataB64] = parts;
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error("Malformed encrypted secret");
    }
    // Legacy payloads carry no key id — the GCM auth tag lets us safely try
    // each key and accept the one that authenticates.
    for (const key of keys.values()) {
      try {
        return decryptWith(key, ivB64, tagB64, dataB64);
      } catch {
        // wrong key — try the next
      }
    }
    throw new Error("No keyring key can decrypt this v1 secret");
  }

  throw new Error("Malformed encrypted secret");
}

/**
 * Returns true if a ciphertext is not encrypted under the current primary key
 * (a legacy v1 payload, or a v2 payload stamped with a rotated-out key id).
 * Use to drive lazy re-encryption after a key rotation.
 */
export function needsReEncryption(encoded: string): boolean {
  const { primaryId } = loadKeyring();
  const parts = encoded.split(":");
  if (parts[0] === "v2") {
    return parts[1] !== primaryId;
  }
  return true;
}

/**
 * Re-encrypts a secret under the current primary key. Safe to call on any
 * ciphertext the keyring can still decrypt.
 */
export function reEncryptToPrimary(encoded: string): string {
  return encryptSecret(decryptSecret(encoded));
}
