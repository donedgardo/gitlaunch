// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { InstanceMode } from "./resolveEntitlement";
import { verifyLicenseKey } from "./licenseKey";
import { BUILD, BuildIdentity } from "./distribution";

export type LicensingEnv = {
  GITLAUNCH_LICENSE_KEY?: string;
  // Index signature so process.env can be passed straight in.
  [key: string]: string | undefined;
};

export type ResolvedInstanceMode = {
  mode: InstanceMode;
  // Why a supplied license was not honoured, for boot logging and the
  // operator's settings page. Null when there is nothing to report.
  licenseError: string | null;
};

export function resolveInstanceMode(
  env: LicensingEnv,
  build: BuildIdentity = BUILD,
): ResolvedInstanceMode {
  // Which distribution this is comes from the build, never from the
  // environment — see distribution.ts.
  if (build.distribution === "saas") {
    return { mode: { kind: "saas" }, licenseError: null };
  }

  // The license key is the one thing the operator legitimately supplies: it is
  // useless without our signature, so there is no harm in it being an env var.
  const key = env.GITLAUNCH_LICENSE_KEY?.trim();
  if (!key) {
    return { mode: { kind: "self-hosted", license: null }, licenseError: null };
  }

  // Verified against the key compiled into this image. Nothing in the
  // environment can change what we trust.
  const result = verifyLicenseKey(key, build.issuerPublicKey);
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
