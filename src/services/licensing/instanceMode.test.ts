import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { resolveInstanceMode } from "./instanceMode";
import { signLicense } from "./licenseKey";

describe("resolveInstanceMode", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();

  const licenseKey = signLicense(
    { licensedTo: "Acme Corp", maxUsers: 25, expiresAt: null },
    privateKey,
  );

  it("should run as the hosted SaaS by default", () => {
    // Given no self-hosting configuration (gitlaunch.com)
    // When the instance boots
    const { mode } = resolveInstanceMode({});

    // Then Stripe governs entitlement, as it does today
    expect(mode.kind).toBe("saas");
  });

  it("should stay hosted unless self-hosting is switched on explicitly", () => {
    // Given a license key but no self-hosted flag
    // When the instance boots
    const { mode } = resolveInstanceMode({
      GITLAUNCH_LICENSE_KEY: licenseKey,
      GITLAUNCH_LICENSE_PUBLIC_KEY: publicKeyPem,
    });

    // Then a stray license variable cannot flip the hosted product's billing off
    expect(mode.kind).toBe("saas");
  });

  it("should load a valid license on a self-hosted instance", () => {
    // Given a self-hosted install configured with its license
    // When it boots
    const { mode, licenseError } = resolveInstanceMode({
      GITLAUNCH_SELF_HOSTED: "true",
      GITLAUNCH_LICENSE_KEY: licenseKey,
      GITLAUNCH_LICENSE_PUBLIC_KEY: publicKeyPem,
    });

    // Then the license governs the install
    expect(mode.kind).toBe("self-hosted");
    if (mode.kind !== "self-hosted") return;
    expect(mode.license?.licensedTo).toBe("Acme Corp");
    expect(mode.license?.maxUsers).toBe(25);
    expect(licenseError).toBeNull();
  });

  it("should boot unlicensed rather than crash on a bad license", () => {
    // Given a self-hosted install with a corrupted license key
    // When it boots
    const { mode, licenseError } = resolveInstanceMode({
      GITLAUNCH_SELF_HOSTED: "true",
      GITLAUNCH_LICENSE_KEY: "garbage",
      GITLAUNCH_LICENSE_PUBLIC_KEY: publicKeyPem,
    });

    // Then the instance still starts — an operator can fix the license from a
    // running dashboard, but not from a crash loop — and the reason is surfaced
    expect(mode.kind).toBe("self-hosted");
    if (mode.kind !== "self-hosted") return;
    expect(mode.license).toBeNull();
    expect(licenseError).toBe("License key is malformed");
  });

  it("should boot unlicensed when no license is supplied at all", () => {
    // Given a self-hosted install with no license yet
    // When it boots
    const { mode, licenseError } = resolveInstanceMode({
      GITLAUNCH_SELF_HOSTED: "true",
    });

    // Then it runs unlicensed, with nothing to report as an error
    expect(mode.kind).toBe("self-hosted");
    if (mode.kind !== "self-hosted") return;
    expect(mode.license).toBeNull();
    expect(licenseError).toBeNull();
  });

  it("should refuse a license signed by a key this build does not trust", () => {
    // Given a license signed by someone else's key
    const attacker = generateKeyPairSync("ed25519");
    const forged = signLicense(
      { licensedTo: "Free Rider", maxUsers: null, expiresAt: null },
      attacker.privateKey,
    );

    // When the instance boots with it
    const { mode, licenseError } = resolveInstanceMode({
      GITLAUNCH_SELF_HOSTED: "true",
      GITLAUNCH_LICENSE_KEY: forged,
      GITLAUNCH_LICENSE_PUBLIC_KEY: publicKeyPem,
    });

    // Then it is not honoured
    expect(mode.kind).toBe("self-hosted");
    if (mode.kind !== "self-hosted") return;
    expect(mode.license).toBeNull();
    expect(licenseError).toBe("License signature is not valid");
  });
});
