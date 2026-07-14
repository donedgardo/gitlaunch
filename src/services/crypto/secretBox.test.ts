import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as crypto from "crypto";
import {
  encryptSecret,
  decryptSecret,
  assertEncryptionKey,
  needsReEncryption,
  reEncryptToPrimary,
} from "./secretBox";

// Deterministic 32-byte keys (base64) for tests.
const TEST_KEY = Buffer.alloc(32, 7).toString("base64");
const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

describe("secretBox", () => {
  const saved = {
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    ENCRYPTION_KEYS: process.env.ENCRYPTION_KEYS,
    ENCRYPTION_PRIMARY_KEY_ID: process.env.ENCRYPTION_PRIMARY_KEY_ID,
  };

  function clearKeyEnv() {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEYS;
    delete process.env.ENCRYPTION_PRIMARY_KEY_ID;
  }

  beforeEach(() => {
    clearKeyEnv();
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    clearKeyEnv();
    if (saved.ENCRYPTION_KEY !== undefined)
      process.env.ENCRYPTION_KEY = saved.ENCRYPTION_KEY;
    if (saved.ENCRYPTION_KEYS !== undefined)
      process.env.ENCRYPTION_KEYS = saved.ENCRYPTION_KEYS;
    if (saved.ENCRYPTION_PRIMARY_KEY_ID !== undefined)
      process.env.ENCRYPTION_PRIMARY_KEY_ID = saved.ENCRYPTION_PRIMARY_KEY_ID;
  });

  describe("encryptSecret / decryptSecret", () => {
    it("should round-trip a secret back to its original plaintext", () => {
      const plaintext = "jenkins-api-token-abc123";
      expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
    });

    it("should produce different ciphertext each time for the same plaintext", () => {
      const plaintext = "same-secret";
      expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
    });

    it("should not leak the plaintext into the ciphertext", () => {
      const plaintext = "super-secret-token";
      expect(encryptSecret(plaintext)).not.toContain(plaintext);
    });

    it("should throw when the ciphertext has been tampered with", () => {
      const encoded = encryptSecret("secret");
      // Flip the last byte of the final (ciphertext) segment.
      const parts = encoded.split(":");
      const data = Buffer.from(parts[parts.length - 1], "base64");
      data[data.length - 1] ^= 0xff;
      parts[parts.length - 1] = data.toString("base64");
      expect(() => decryptSecret(parts.join(":"))).toThrow();
    });

    it("should throw on a malformed payload", () => {
      expect(() => decryptSecret("not-a-valid-payload")).toThrow(/malformed/i);
    });

    it("should throw when decrypting with a different key", () => {
      const encoded = encryptSecret("secret");
      process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
      expect(() => decryptSecret(encoded)).toThrow();
    });
  });

  describe("assertEncryptionKey", () => {
    it("should pass when a valid 32-byte key is set", () => {
      expect(() => assertEncryptionKey()).not.toThrow();
    });

    it("should throw when no key is configured", () => {
      clearKeyEnv();
      expect(() => assertEncryptionKey()).toThrow(/ENCRYPTION_KEY/);
    });

    it("should throw when the key is the wrong length", () => {
      process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
      expect(() => assertEncryptionKey()).toThrow(/32 bytes/);
    });
  });

  describe("key rotation", () => {
    beforeEach(() => {
      clearKeyEnv();
    });

    function setKeyring(entries: Record<string, string>, primaryId: string) {
      process.env.ENCRYPTION_KEYS = Object.entries(entries)
        .map(([id, key]) => `${id}:${key}`)
        .join(",");
      process.env.ENCRYPTION_PRIMARY_KEY_ID = primaryId;
    }

    it("should still decrypt data after the primary key is rotated", () => {
      // Given: data encrypted under k1
      setKeyring({ k1: KEY_A }, "k1");
      const encoded = encryptSecret("jenkins-token");

      // When: we rotate — k2 becomes primary, k1 retained for decryption
      setKeyring({ k1: KEY_A, k2: KEY_B }, "k2");

      // Then: the old ciphertext is not stranded
      expect(decryptSecret(encoded)).toBe("jenkins-token");
    });

    it("should encrypt new data with the primary key only", () => {
      // Given: k2 is primary
      setKeyring({ k1: KEY_A, k2: KEY_B }, "k2");
      const encoded = encryptSecret("fresh");

      // Then: it decrypts with k2 alone...
      setKeyring({ k2: KEY_B }, "k2");
      expect(decryptSecret(encoded)).toBe("fresh");

      // ...but not with k1 alone (proving k1 wasn't used)
      setKeyring({ k1: KEY_A }, "k1");
      expect(() => decryptSecret(encoded)).toThrow();
    });

    it("should still decrypt legacy v1 ciphertext after moving to a keyring", () => {
      // Given: a legacy v1 payload produced by the old single-key scheme (KEY_A)
      const legacy = makeV1Payload("legacy-token", KEY_A);

      // When: we move to a keyring that still contains that key
      setKeyring({ old: KEY_A, k2: KEY_B }, "k2");

      // Then: the legacy ciphertext still decrypts
      expect(decryptSecret(legacy)).toBe("legacy-token");
    });

    it("should report whether a ciphertext needs re-encryption to the primary", () => {
      setKeyring({ k1: KEY_A }, "k1");
      const underK1 = encryptSecret("x");

      // Fresh under primary → no re-encryption needed
      expect(needsReEncryption(underK1)).toBe(false);

      // After rotation, the k1 ciphertext is stale
      setKeyring({ k1: KEY_A, k2: KEY_B }, "k2");
      expect(needsReEncryption(underK1)).toBe(true);

      // Legacy v1 always needs re-encryption
      expect(needsReEncryption(makeV1Payload("x", KEY_A))).toBe(true);
    });

    it("should re-encrypt a stale ciphertext to the primary key", () => {
      setKeyring({ k1: KEY_A }, "k1");
      const underK1 = encryptSecret("rotate-me");

      // Rotate, then upgrade the old ciphertext to the new primary
      setKeyring({ k1: KEY_A, k2: KEY_B }, "k2");
      const upgraded = reEncryptToPrimary(underK1);

      expect(needsReEncryption(upgraded)).toBe(false);
      expect(decryptSecret(upgraded)).toBe("rotate-me");

      // And it no longer depends on k1
      setKeyring({ k2: KEY_B }, "k2");
      expect(decryptSecret(upgraded)).toBe("rotate-me");
    });

    it("should throw when the primary key id is not in the keyring", () => {
      setKeyring({ k1: KEY_A }, "missing");
      expect(() => assertEncryptionKey()).toThrow(/primary/i);
    });
  });
});

// Builds a legacy v1 payload the way the original single-key secretBox did.
function makeV1Payload(plaintext: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ct.toString("base64"),
  ].join(":");
}
