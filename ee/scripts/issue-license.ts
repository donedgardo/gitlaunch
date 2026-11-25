#!/usr/bin/env tsx
// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

/**
 * License issuer — our side of an enterprise sale. See
 * the internal enterprise delivery runbook for where this sits in the process.
 *
 * One-time setup, generating the issuer keypair:
 *
 *   tsx ee/scripts/issue-license.ts keygen ./issuer
 *     -> ./issuer-private.pem  (NEVER leaves our secret store)
 *     -> ./issuer-public.pem   (compiled into the customer image)
 *
 * Per sale:
 *
 *   tsx ee/scripts/issue-license.ts issue \
 *     --to "Acme Corp" --seats 50 --expires 2027-07-27 \
 *     --key ./issuer-private.pem
 *
 * Prints the license key to hand to the customer.
 */
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  signLicense,
  verifyLicenseKey,
} from "../services/licensing/licenseKey";

function fail(message: string): never {
  console.error(`issue-license: ${message}`);
  process.exit(1);
}

function keygen(prefix: string): void {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  const privatePath = `${prefix}-private.pem`;
  const publicPath = `${prefix}-public.pem`;

  writeFileSync(
    privatePath,
    privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    // Owner-only: this key is the entire licensing scheme.
    { mode: 0o600 },
  );
  writeFileSync(
    publicPath,
    publicKey.export({ type: "spki", format: "pem" }).toString(),
  );

  console.info(`Wrote ${privatePath} and ${publicPath}`);
  console.info("");
  console.info(
    `  ${privatePath} signs every customer license. Put it in the secret store and`,
  );
  console.info(
    "  keep it out of the repository and out of any image. Losing it means",
  );
  console.info(
    "  re-issuing every outstanding license; leaking it means anyone can mint them.",
  );
  console.info("");
  console.info(
    `  ${publicPath} is compiled into the customer image by ee/scripts/set-distribution.ts.`,
  );
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag?.startsWith("--")) {
      fail(`unexpected argument "${flag}"`);
    }
    const value = argv[i + 1];
    if (value === undefined) {
      fail(`${flag} needs a value`);
    }
    args[flag.slice(2)] = value;
  }
  return args;
}

function issue(argv: string[]): void {
  const args = parseArgs(argv);
  const licensedTo = args.to;
  const keyPath = args.key;

  if (!licensedTo) {
    fail('--to "Customer Name" is required — it identifies the licensee');
  }
  if (!keyPath) {
    fail("--key ./issuer-private.pem is required");
  }

  // Seats are the one resource a self-hosted license meters. Omitting --seats
  // issues a site license, so it has to be explicit rather than a default.
  let maxUsers: number | null = null;
  if (args.seats !== undefined) {
    const seats = Number(args.seats);
    if (!Number.isInteger(seats) || seats < 1) {
      fail(`--seats must be a positive whole number, got "${args.seats}"`);
    }
    maxUsers = seats;
  }

  let expiresAt: string | null = null;
  if (args.expires !== undefined) {
    const date = new Date(args.expires);
    if (Number.isNaN(date.getTime())) {
      fail(`--expires must be a date, e.g. 2027-07-27 (got "${args.expires}")`);
    }
    if (date.getTime() < Date.now()) {
      fail(`--expires ${args.expires} is in the past`);
    }
    expiresAt = date.toISOString();
  }

  const privateKeyPem = readFileSync(keyPath, "utf8");
  let privateKey;
  try {
    privateKey = createPrivateKey(privateKeyPem);
  } catch (error) {
    fail(`${keyPath} is not a readable private key: ${error}`);
  }

  const license = signLicense({ licensedTo, maxUsers, expiresAt }, privateKey);

  // Verify what we are about to send, using the public key derived from this
  // private key. Issuing a license the customer's instance then rejects is a
  // bad first day.
  const check = verifyLicenseKey(license, createPublicKey(privateKey));
  if (!check.valid) {
    fail(`refusing to issue a license that does not verify: ${check.reason}`);
  }

  console.info("");
  console.info(`  Licensed to : ${licensedTo}`);
  console.info(`  Seats       : ${maxUsers ?? "unlimited (site license)"}`);
  console.info(
    `  Expires     : ${expiresAt ? expiresAt.slice(0, 10) : "never (perpetual)"}`,
  );
  console.info("");
  console.info("  License key (give this to the customer):");
  console.info("");
  console.info(license);
  console.info("");
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "keygen":
    keygen(rest[0] ?? "./issuer");
    break;
  case "issue":
    issue(rest);
    break;
  default:
    fail("usage: issue-license.ts <keygen|issue> [...]");
}
