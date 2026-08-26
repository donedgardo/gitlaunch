// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { KeyLike, sign, verify } from "node:crypto";
import { SelfHostedLicense } from "./resolveEntitlement";

// A license key is `base64url(claims JSON).base64url(ed25519 signature)`.
//
// Ed25519 rather than a shared secret: the instance ships with the *public*
// key, so a customer running the image can verify a license but cannot mint
// one. Nothing here talks to the network — a self-hosted install must keep
// working in an air-gapped datacentre, so entitlement is proven by signature
// rather than by phoning home.

export type LicenseClaims = {
  licensedTo?: string;
  // Seats sold. Absent or null means a site license with no seat cap.
  maxUsers?: number | null;
  // ISO 8601, or null for perpetual.
  expiresAt?: string | null;
};

export type VerifyLicenseResult =
  | { valid: true; license: SelfHostedLicense }
  | { valid: false; reason: string };

// Used by the license issuer (our side of the sale). Lives here so the format
// has exactly one definition and the tests exercise the real round trip.
export function signLicense(
  claims: LicenseClaims,
  privateKey: KeyLike,
): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign(null, Buffer.from(payload), privateKey).toString(
    "base64url",
  );
  return `${payload}.${signature}`;
}

export function verifyLicenseKey(
  key: string,
  publicKey: KeyLike,
): VerifyLicenseResult {
  if (!publicKey || (typeof publicKey === "string" && !publicKey.trim())) {
    // Fail closed: no key means we cannot tell a real license from a forged
    // one, and the safe reading of "cannot tell" is "not licensed".
    return { valid: false, reason: "No license public key configured" };
  }

  const [payload, signature, ...rest] = key.split(".");
  if (!payload || !signature || rest.length > 0) {
    return { valid: false, reason: "License key is malformed" };
  }

  let signatureMatches: boolean;
  try {
    signatureMatches = verify(
      null,
      Buffer.from(payload),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    // A bad key, wrong curve or unparseable signature is a refusal, not a crash
    // — this runs on the boot path of a customer's install.
    return { valid: false, reason: "License signature is not valid" };
  }
  if (!signatureMatches) {
    return { valid: false, reason: "License signature is not valid" };
  }

  // Claims are only read after the signature proves we wrote them.
  let claims: LicenseClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "License key is malformed" };
  }

  if (!claims || typeof claims.licensedTo !== "string" || !claims.licensedTo) {
    return { valid: false, reason: "License key is malformed" };
  }

  return {
    valid: true,
    license: {
      licensedTo: claims.licensedTo,
      maxUsers: claims.maxUsers ?? null,
      expiresAt: claims.expiresAt ? new Date(claims.expiresAt) : null,
    },
  };
}
