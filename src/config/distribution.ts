// Which build this is, and the key it trusts. Both are decided when the image
// is built and are NOT readable from the environment.
//
// This file is the one thing that differs between the hosted product and the
// image we ship to customers. `scripts/set-distribution.ts` rewrites it during
// the release build, stamping in the issuer public key.
//
// It is deliberately not configurable at runtime. A customer runs the
// distribution build on infrastructure they control, so anything they can set —
// an env var, a ConfigMap, a database row — is something they can set to
// whatever they like. If the environment could name the distribution, setting
// it to "saas" would move entitlement to plan limits held in a database they
// own. If the environment could name the issuer key, they could mint their own
// licenses. So neither comes from the environment.

export type Distribution = "saas" | "self-hosted";

export type BuildIdentity = {
  distribution: Distribution;
  // PEM-encoded Ed25519 public key of the GitLaunch license issuer. Empty on
  // the hosted build, which has no licenses to verify.
  issuerPublicKey: string;
};

export const BUILD: BuildIdentity = {
  distribution: "saas",
  issuerPublicKey: "",
};
