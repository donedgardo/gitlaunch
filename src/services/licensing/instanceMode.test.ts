import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { resolveInstanceMode } from "./instanceMode";
import { signLicense } from "./licenseKey";

describe("resolveInstanceMode", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const issuerPublicKey = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();

  // How the published customer image is built: self-hosted, with our issuer
  // key compiled in.
  const distributionBuild = {
    distribution: "self-hosted" as const,
    issuerPublicKey,
  };
  // How gitlaunch.com is built.
  const hostedBuild = { distribution: "saas" as const, issuerPublicKey: "" };

  const licenseKey = signLicense(
    { licensedTo: "Acme Corp", maxUsers: 25, expiresAt: null },
    privateKey,
  );

  it("should run the hosted build as SaaS", () => {
    // Given the build that runs gitlaunch.com
    // When it boots
    const { mode } = resolveInstanceMode({}, hostedBuild);

    // Then Stripe governs entitlement
    expect(mode.kind).toBe("saas");
  });

  it("should run the distribution build as self-hosted", () => {
    // Given the published customer image with a license
    // When it boots
    const { mode, licenseError } = resolveInstanceMode(
      { GITLAUNCH_LICENSE_KEY: licenseKey },
      distributionBuild,
    );

    // Then the license governs it
    expect(mode.kind).toBe("self-hosted");
    if (mode.kind !== "self-hosted") return;
    expect(mode.license?.licensedTo).toBe("Acme Corp");
    expect(mode.license?.maxUsers).toBe(25);
    expect(licenseError).toBeNull();
  });

  it("should not let the environment turn a distribution build into a SaaS one", () => {
    // Given a customer trying to escape licensing by claiming to be the hosted
    // product — where entitlement would come from plan limits in a database
    // they control
    const { mode } = resolveInstanceMode(
      {
        GITLAUNCH_SELF_HOSTED: "false",
        STRIPE_SECRET_KEY: "sk_live_their_own_account",
      },
      distributionBuild,
    );

    // Then it stays self-hosted. Which distribution this is, is decided when we
    // build the image, never by the environment it runs in.
    expect(mode.kind).toBe("self-hosted");
  });

  it("should not let the environment supply the key licenses are checked against", () => {
    // Given a customer who generated their own keypair and minted themselves a
    // license with it
    const theirs = generateKeyPairSync("ed25519");
    const selfIssued = signLicense(
      { licensedTo: "Acme Corp", maxUsers: null, expiresAt: null },
      theirs.privateKey,
    );

    // When they point the instance at their own public key
    const { mode, licenseError } = resolveInstanceMode(
      {
        GITLAUNCH_LICENSE_KEY: selfIssued,
        GITLAUNCH_LICENSE_PUBLIC_KEY: theirs.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
      },
      distributionBuild,
    );

    // Then it is refused — only the key compiled into the image is trusted, so
    // a self-minted license is worth nothing
    expect(mode.kind).toBe("self-hosted");
    if (mode.kind !== "self-hosted") return;
    expect(mode.license).toBeNull();
    expect(licenseError).toBe("License signature is not valid");
  });

  it("should boot unlicensed rather than crash on a bad license", () => {
    // Given a corrupted license key
    const { mode, licenseError } = resolveInstanceMode(
      { GITLAUNCH_LICENSE_KEY: "garbage" },
      distributionBuild,
    );

    // Then the instance still starts, and the reason is surfaced — an operator
    // can fix a license from a running dashboard, not from a crash loop
    expect(mode.kind).toBe("self-hosted");
    if (mode.kind !== "self-hosted") return;
    expect(mode.license).toBeNull();
    expect(licenseError).toBe("License key is malformed");
  });

  it("should boot unlicensed when no license is supplied", () => {
    // Given a fresh install before the license is applied
    const { mode, licenseError } = resolveInstanceMode({}, distributionBuild);

    // Then it runs unlicensed with nothing to report as an error
    expect(mode.kind).toBe("self-hosted");
    if (mode.kind !== "self-hosted") return;
    expect(mode.license).toBeNull();
    expect(licenseError).toBeNull();
  });

  it("should honour no license at all if an image ships without an issuer key", () => {
    // Given a misbuilt distribution image with no issuer key compiled in
    const { mode, licenseError } = resolveInstanceMode(
      { GITLAUNCH_LICENSE_KEY: licenseKey },
      { distribution: "self-hosted", issuerPublicKey: "" },
    );

    // Then it fails closed rather than accepting unverifiable claims
    expect(mode.kind).toBe("self-hosted");
    if (mode.kind !== "self-hosted") return;
    expect(mode.license).toBeNull();
    expect(licenseError).toBe("No license public key configured");
  });
});
