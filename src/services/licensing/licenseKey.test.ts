// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { signLicense, verifyLicenseKey } from "./licenseKey";

describe("verifyLicenseKey", () => {
  // Real Ed25519 keys — a license is the thing standing between the product and
  // anyone who can set an environment variable, so this is never mocked.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const otherKeyPair = generateKeyPairSync("ed25519");

  const claims = {
    licensedTo: "Acme Corp",
    maxUsers: 50,
    expiresAt: "2027-01-01T00:00:00.000Z",
  };

  it("should read the claims out of a license we issued", () => {
    // Given a license signed with our private key
    const key = signLicense(claims, privateKey);

    // When the instance verifies it
    const result = verifyLicenseKey(key, publicKey);

    // Then the claims come back intact
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.license.licensedTo).toBe("Acme Corp");
    expect(result.license.maxUsers).toBe(50);
    expect(result.license.expiresAt).toEqual(
      new Date("2027-01-01T00:00:00.000Z"),
    );
  });

  it("should treat an absent seat cap as a site license", () => {
    // Given a license with no maxUsers claim
    const key = signLicense(
      { licensedTo: "Acme Corp", expiresAt: null },
      privateKey,
    );

    // When it is verified
    const result = verifyLicenseKey(key, publicKey);

    // Then seats are uncapped and it never expires
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.license.maxUsers).toBeNull();
    expect(result.license.expiresAt).toBeNull();
  });

  it("should reject a license signed by someone else's key", () => {
    // Given a license signed with a key we did not issue
    const key = signLicense(claims, otherKeyPair.privateKey);

    // When it is verified against our public key
    const result = verifyLicenseKey(key, publicKey);

    // Then it is refused
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe("License signature is not valid");
  });

  it("should reject a license whose claims were edited after signing", () => {
    // Given a genuine 50-seat license
    const key = signLicense(claims, privateKey);
    const [, signature] = key.split(".");

    // When someone re-writes the seat count and keeps the old signature
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...claims, maxUsers: 99999 }),
    ).toString("base64url");
    const forged = `${forgedPayload}.${signature}`;

    // Then the signature no longer matches the payload
    const result = verifyLicenseKey(forged, publicKey);
    expect(result.valid).toBe(false);
  });

  it("should reject a key that is not in license format", () => {
    // Given junk in the license environment variable
    // When it is verified
    const result = verifyLicenseKey("not-a-license", publicKey);

    // Then it is refused without throwing
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe("License key is malformed");
  });

  it("should reject a well-formed key carrying unreadable claims", () => {
    // Given a payload that is validly signed but is not license JSON
    const payload = Buffer.from("this is not json").toString("base64url");
    const signature = sign(null, Buffer.from(payload), privateKey).toString(
      "base64url",
    );

    // When it is verified
    const result = verifyLicenseKey(`${payload}.${signature}`, publicKey);

    // Then it is refused
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe("License key is malformed");
  });

  it("should reject a license with no licensee", () => {
    // Given a signed license missing the one claim that identifies the customer
    const key = signLicense({ expiresAt: null }, privateKey);

    // When it is verified
    const result = verifyLicenseKey(key, publicKey);

    // Then it is refused
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe("License key is malformed");
  });

  it("should refuse to verify when the instance has no public key configured", () => {
    // Given a build with no embedded public key
    const key = signLicense(claims, privateKey);

    // When verification is attempted
    const result = verifyLicenseKey(key, "");

    // Then it fails closed rather than trusting the claims
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe("No license public key configured");
  });
});
