import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import fastifyView from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { registerDocsRoutes } from "./index";

// Shared on a developer Discord, the landing page was read as an email
// harvester: a waitlist form and no way to see how the product actually works.
// This page is the answer — the whole integration contract, readable by anyone
// with no account, no session and no email address.
describe("public docs, rendered", () => {
  let app: FastifyInstance;

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
    registerDocsRoutes(app, { publicUrl: "https://gitlaunch.example" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should serve the docs to anyone, with no session", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<h1>How GitLaunch works</h1>");
  });

  it("should show the full build-report and deploy contract, not a teaser", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    // The two directions of the loop, as real HTTP a reader could run today,
    // addressed to this instance rather than to the hosted one.
    expect(response.body).toContain(
      "https://gitlaunch.example/api/v1/services/",
    );
    expect(response.body).toContain("POST");
    expect(response.body).toContain("/builds");
    expect(response.body).toContain("PATCH");
    expect(response.body).toContain("/deploy/");
    for (const status of ["deploying", "deployed", "error", "cancelled"]) {
      expect(response.body).toContain(status);
    }
  });

  it("should name every CI system the snippets cover, so it reads as on-top-of CI rather than instead-of", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    for (const ci of ["GitHub Actions", "GitLab CI", "Jenkins", "CircleCI"]) {
      expect(response.body).toContain(ci);
    }
    expect(response.body).toMatch(/not (another|a) CI/i);
  });

  it("should point at the source and at self-hosting", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    // Open core is the strongest answer to "what happens to my email" — the
    // reader can run it themselves without giving us anything.
    expect(response.body).toContain("https://github.com/donedgardo/launchpad");
    expect(response.body).toMatch(/self-host/i);
  });

  it("should link to the agent skill it serves", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    expect(response.body).toContain("/skills/gitlaunch-onboarding/SKILL.md");
  });

  it("should be indexable and leave no unresolved placeholders", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    expect(response.body).toContain(
      '<meta name="robots" content="index, follow" />',
    );
    expect(response.body).toContain(
      '<link rel="canonical" href="https://gitlaunch.example/docs" />',
    );
    expect(response.body).not.toContain("{{");
  });
});
