import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, assertEncryptionKey } from "./secretBox";

// A deterministic 32-byte key (base64) for the happy-path tests.
const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

describe("secretBox", () => {
  const savedKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = savedKey;
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
      const [v, iv, tag, data] = encoded.split(":");
      // Flip the last data byte so the auth tag no longer matches.
      const bytes = Buffer.from(data, "base64");
      bytes[bytes.length - 1] ^= 0xff;
      const tampered = [v, iv, tag, bytes.toString("base64")].join(":");
      expect(() => decryptSecret(tampered)).toThrow();
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

    it("should throw when the key is missing", () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => assertEncryptionKey()).toThrow(/ENCRYPTION_KEY is not set/);
    });

    it("should throw when the key is the wrong length", () => {
      process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
      expect(() => assertEncryptionKey()).toThrow(/32 bytes/);
    });
  });
});
