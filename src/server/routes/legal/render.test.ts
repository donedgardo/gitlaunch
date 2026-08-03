import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import fastifyView from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { registerLegalRoutes } from "./index";

// The sibling suite stubs `reply.view` to inspect what the route passes down.
// That cannot catch a template that does not exist, a partial nobody
// registered, or a Handlebars syntax error — each of which would serve a 500 on
// a URL that GitHub, Stripe and Google fetch before approving an integration.
//
// So this suite renders the real templates through the real view engine,
// configured the way registerPlugins configures it, and reads the HTML that
// comes out.
describe("legal pages, rendered", () => {
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
    registerLegalRoutes(app, { publicUrl: "http://localhost:3050" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const pages = [
    { url: "/privacy", heading: "Privacy Policy" },
    { url: "/terms", heading: "Terms of Service" },
  ];

  for (const page of pages) {
    describe(page.url, () => {
      it(`should render ${page.heading} as real HTML`, async () => {
        const response = await app.inject({ method: "GET", url: page.url });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain(`<h1>${page.heading}</h1>`);
      });

      it("should render the shared styling rather than an empty partial", async () => {
        const response = await app.inject({ method: "GET", url: page.url });

        // A partial that failed to register renders as nothing at all, leaving
        // an unstyled wall of text that still returns 200.
        expect(response.body).toContain("<style>");
        expect(response.body).toContain(".legal .body");
      });

      it("should show the reader the effective date", async () => {
        const response = await app.inject({ method: "GET", url: page.url });

        expect(response.body).toMatch(/Effective\s+\w+ \d{1,2}, \d{4}/);
      });

      it("should leave no unresolved template placeholders", async () => {
        const response = await app.inject({ method: "GET", url: page.url });

        // A mistyped variable renders as empty, but a mistyped *expression*
        // can survive into the output. Either way, no braces should reach a
        // reader of a legal document.
        expect(response.body).not.toContain("{{");
      });

      it("should link to the other legal document", async () => {
        const response = await app.inject({ method: "GET", url: page.url });

        // Each document incorporates or references the other; a reader must be
        // able to reach it without going back to the landing page.
        const other = page.url === "/privacy" ? "/terms" : "/privacy";
        expect(response.body).toContain(`href="${other}"`);
      });
    });
  }

  it("should not leak internal drafting notes to the reader", async () => {
    // The templates carry TODO(legal) markers in Handlebars comments for the
    // details a human must confirm before publishing. Handlebars comments are
    // stripped at render time — but an HTML comment would ship straight to the
    // page source, which is not where an unresolved legal question belongs.
    const privacy = await app.inject({ method: "GET", url: "/privacy" });
    const terms = await app.inject({ method: "GET", url: "/terms" });

    expect(privacy.body).not.toContain("TODO(legal)");
    expect(terms.body).not.toContain("TODO(legal)");
  });

  it("should only point readers at a mailbox that exists", async () => {
    // These documents promise a reply — GDPR rights requests, security
    // disclosure, the 30-day informal dispute step. Naming a plausible-looking
    // address nobody monitors (legal@, privacy@, security@) turns each of those
    // promises into a dead end, and the failure is silent: mail bounces to the
    // sender, not to us. support@ is the one address that is actually staffed.
    const privacy = await app.inject({ method: "GET", url: "/privacy" });
    const terms = await app.inject({ method: "GET", url: "/terms" });

    for (const body of [privacy.body, terms.body]) {
      const addresses = new Set(
        [...body.matchAll(/mailto:([^"]+)/g)].map((m) => m[1]),
      );
      expect([...addresses]).toEqual(["support@gitlaunch.dev"]);
    }
  });

  it("should state the governing jurisdiction in the terms", async () => {
    // The single clause most likely to be quietly wrong after a copy-paste from
    // another company's terms.
    const response = await app.inject({ method: "GET", url: "/terms" });

    expect(response.body).toContain("Puerto Rico");
  });
});
