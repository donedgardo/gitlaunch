import { InstanceMode } from "./resolveEntitlement";
import { verifyLicenseKey } from "./licenseKey";

// The Ed25519 public key of the GitLaunch license issuer, baked into official
// release builds. Empty here so an unconfigured build cannot honour any
// license; distribution builds set it, and `GITLAUNCH_LICENSE_PUBLIC_KEY`
// overrides it for testing and for customers running their own issuer.
const ISSUER_PUBLIC_KEY = "";

export type LicensingEnv = {
  GITLAUNCH_SELF_HOSTED?: string;
  GITLAUNCH_LICENSE_KEY?: string;
  GITLAUNCH_LICENSE_PUBLIC_KEY?: string;
  // Index signature so process.env can be passed straight in.
  [key: string]: string | undefined;
};

export type ResolvedInstanceMode = {
  mode: InstanceMode;
  // Why a supplied license was not honoured, for boot logging and the
  // operator's settings page. Null when there is nothing to report.
  licenseError: string | null;
};

export function resolveInstanceMode(env: LicensingEnv): ResolvedInstanceMode {
  // Self-hosting is opt-in and explicit. A stray license variable must never be
  // able to switch billing off on the hosted product.
  if (env.GITLAUNCH_SELF_HOSTED !== "true") {
    return { mode: { kind: "saas" }, licenseError: null };
  }

  const key = env.GITLAUNCH_LICENSE_KEY?.trim();
  if (!key) {
    return {
      mode: { kind: "self-hosted", license: null },
      licenseError: null,
    };
  }

  const publicKey =
    env.GITLAUNCH_LICENSE_PUBLIC_KEY?.trim() || ISSUER_PUBLIC_KEY;
  const result = verifyLicenseKey(key, publicKey);
  if (!result.valid) {
    // Never fail the boot on a bad license. An operator can fix a license from
    // a running dashboard but not from a crash loop, and an install that dies
    // on expiry is an outage we inflicted on a paying customer.
    return {
      mode: { kind: "self-hosted", license: null },
      licenseError: result.reason,
    };
  }

  return {
    mode: { kind: "self-hosted", license: result.license },
    licenseError: null,
  };
}
