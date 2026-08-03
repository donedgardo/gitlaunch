import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import fastifyView from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { registerLegalRoutes } from "./index";

// A privacy policy is a factual claim about a system that changes every week.
// Nothing else in this repo fails when the two drift apart — which is exactly
// how the published policy came to describe GitHub as the only way to sign in,
// weeks after Google and email/password login shipped, and how Resend became an
// undisclosed subprocessor.
//
// These tests read the rendered documents and compare them against the code, so
// that adding a sign-in method or a vendor API breaks the build until the
// disclosure catches up.

const SRC = path.join(__dirname, "../../..");

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (entry.endsWith(".ts") && !entry.includes(".test.")) {
      acc.push(full);
    }
  }
  return acc;
}

// Every third-party API host the production code talks to, mapped to the name
// the privacy policy must disclose it under. Adding a vendor means adding a row
// here *and* to the subprocessor table — that is the point.
const VENDOR_API_HOSTS: Record<string, string> = {
  "api.github.com": "GitHub",
  "api.resend.com": "Resend",
};

describe("legal documents match the system they describe", () => {
  let app: FastifyInstance;
  let privacy = "";
  let terms = "";

  beforeAll(async () => {
    app = Fastify();
    await app.register(fastifyView, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
      options: {
        compileOptions: { preventIndent: true },
        partials: { legalStyles: "/partials/legalStyles.hbs" },
      },
    });
    registerLegalRoutes(app, { publicUrl: "http://localhost:3050" });
    await app.ready();

    privacy = (await app.inject({ method: "GET", url: "/privacy" })).body;
    terms = (await app.inject({ method: "GET", url: "/terms" })).body;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("subprocessors", () => {
    it("should disclose every vendor API the code actually calls", () => {
      // Scans production source for third-party API hosts. A new vendor —
      // api.sendgrid.com, api.openai.com — fails here until it is named in the
      // policy, because sending personal data to an undisclosed processor is
      // exactly what GDPR Art. 28 is about.
      const sources = sourceFiles(path.join(SRC, "services"))
        .concat(sourceFiles(path.join(SRC, "server")))
        .map((f) => readFileSync(f, "utf8"))
        .join("\n");

      const hosts = new Set(
        [
          ...sources.matchAll(/https:\/\/(api\.[a-z0-9-]+\.(?:com|io|dev))/g),
        ].map((m) => m[1]),
      );

      for (const host of hosts) {
        const vendor = VENDOR_API_HOSTS[host];
        expect(
          vendor,
          `${host} is called in production code but is not mapped to a disclosed vendor`,
        ).toBeTruthy();
        expect(
          privacy,
          `${host} is called in production code but "${vendor}" is not named in the privacy policy`,
        ).toContain(vendor);
      }
    });

    it("should name the transactional email provider", () => {
      // Verification emails carry a personal email address and a login-granting
      // token to this provider. It is a processor, not a detail.
      expect(privacy).toContain("Resend");
    });
  });

  describe("sign-in methods", () => {
    // The policy must account for every credential a user can present, because
    // each one is a different category of personal data.
    const authRoutes = path.join(SRC, "server/routes/auth");

    it("should describe every sign-in method the app offers", () => {
      const methods = readdirSync(authRoutes).filter(
        (f) => f.endsWith(".ts") && !f.includes(".test."),
      );

      // Guards the mapping below: a new provider file means a new disclosure.
      expect(methods.sort()).toEqual([
        "emailPassword.ts",
        "github.ts",
        "google.ts",
      ]);

      // Asserted as sign-in phrases, not bare vendor names: the policy already
      // says "No Google Analytics" elsewhere, and a substring check on "Google"
      // passes on that sentence while the sign-in method goes undisclosed.
      expect(privacy).toMatch(/sign in with GitHub/i);
      expect(privacy).toMatch(/sign in with Google/i);
      expect(privacy).toMatch(/sign in with an email address and a password/i);
    });

    it("should tell password users how their password is stored", () => {
      // Storing a password is a materially different promise from never
      // receiving one, which is what the policy used to say.
      expect(privacy).toMatch(/bcrypt/i);
    });

    it("should state in the terms that more than one sign-in method exists", () => {
      // The terms previously said "You sign in through GitHub", which is now
      // wrong for two of the three routes in.
      expect(terms).toContain("Google");
      expect(terms).toMatch(/password/i);
    });
  });

  describe("claims that must stay true", () => {
    it("should only promise we cannot read source code while that remains so", () => {
      // The strongest claim in the policy. If anyone ever requests the GitHub
      // contents permission, this fails and the claim must come out.
      const github = sourceFiles(path.join(SRC, "services/github"))
        .map((f) => readFileSync(f, "utf8"))
        .join("\n");

      expect(github).not.toMatch(/["'`]contents["'`]|\/contents/);
      expect(privacy).toContain("never receive your source code");
    });
  });
});
