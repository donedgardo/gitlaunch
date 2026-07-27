#!/usr/bin/env tsx
/**
 * Stamps the build identity into src/services/licensing/distribution.ts before
 * a release build. Run by the distribution image build — see
 * docs/ENTERPRISE-DELIVERY.md.
 *
 *   tsx scripts/set-distribution.ts self-hosted ./issuer-public.pem
 *   tsx scripts/set-distribution.ts saas
 *
 * The result is compiled into dist/, which is what makes the distribution
 * choice and the trusted issuer key unreachable from the environment a
 * customer controls.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicKey } from "node:crypto";
import { resolve } from "node:path";

const TARGET = resolve(
  __dirname,
  "..",
  "src",
  "services",
  "licensing",
  "distribution.ts",
);

function fail(message: string): never {
  console.error(`set-distribution: ${message}`);
  process.exit(1);
}

const [distribution, publicKeyPath] = process.argv.slice(2);

if (distribution !== "saas" && distribution !== "self-hosted") {
  fail("usage: set-distribution.ts <saas|self-hosted> [issuer-public-key.pem]");
}

let issuerPublicKey = "";

if (distribution === "self-hosted") {
  if (!publicKeyPath) {
    fail(
      "a self-hosted build needs the issuer public key: set-distribution.ts self-hosted ./issuer-public.pem",
    );
  }

  issuerPublicKey = readFileSync(publicKeyPath, "utf8").trim();

  // Refuse to ship an image that trusts something unusable, or — far worse —
  // a private key accidentally passed where the public one belongs.
  if (issuerPublicKey.includes("PRIVATE KEY")) {
    fail(
      `${publicKeyPath} is a PRIVATE key. Only the public key may be compiled into a customer image.`,
    );
  }
  try {
    const key = createPublicKey(issuerPublicKey);
    if (key.asymmetricKeyType !== "ed25519") {
      fail(
        `expected an ed25519 public key, got ${key.asymmetricKeyType ?? "unknown"}`,
      );
    }
  } catch (error) {
    fail(`${publicKeyPath} is not a readable public key: ${error}`);
  }
}

const source = readFileSync(TARGET, "utf8");

// Replace only the exported constant, leaving the explanatory comment intact.
const stamped = source.replace(
  /export const BUILD: BuildIdentity = \{[\s\S]*?\n\};/,
  `export const BUILD: BuildIdentity = {
  distribution: ${JSON.stringify(distribution)},
  issuerPublicKey: ${JSON.stringify(issuerPublicKey)},
};`,
);

if (stamped === source) {
  fail(
    "could not find the BUILD constant in distribution.ts — has its shape changed?",
  );
}

writeFileSync(TARGET, stamped);

console.info(`set-distribution: built as ${distribution}`);
if (distribution === "self-hosted") {
  console.info(`set-distribution: trusting issuer key from ${publicKeyPath}`);
}
