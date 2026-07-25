import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { registerLegalRoutes } from "./index";

// Captures what a legal page was rendered with, so we can assert on the values
// the route hands the view without standing up Handlebars.
let rendered: { template: string; data: Record<string, unknown> } | null = null;

const capturingViewPlugin = fp(async (app: FastifyInstance) => {
  app.decorateReply(
    "view",
    function (this: FastifyReply, template: string, data?: any) {
      rendered = { template, data: data ?? {} };
      return this.header("Content-Type", "text/html").send("<html></html>");
    },
  );
});

describe("legal routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    rendered = null;
    app = Fastify();
    await app.register(capturingViewPlugin);
    registerLegalRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("privacy policy", () => {
    it("should serve a privacy policy to anyone who asks for it", async () => {
      // Given a visitor who follows the Privacy link in the footer
      // When they request the page
      const response = await app.inject({ method: "GET", url: "/privacy" });

      // Then they get a real page, not a 404. Reviewers at GitHub, Stripe and
      // Google all fetch this URL unauthenticated before approving an
      // integration, so it must answer for everyone.
      expect(response.statusCode).toBe(200);
    });

    it("should tell the reader when the policy last changed", async () => {
      // When the privacy policy renders
      await app.inject({ method: "GET", url: "/privacy" });

      // Then it carries an effective date — a policy you cannot date is a
      // policy you cannot prove someone agreed to.
      expect(rendered?.data.lastUpdated).toBeTruthy();
    });

    it("should let search engines index the privacy policy", async () => {
      // When the privacy policy renders
      await app.inject({ method: "GET", url: "/privacy" });

      // Then it is indexable and self-canonical: automated reviewers and
      // users must be able to find it without following a link from us.
      const meta = rendered?.data.meta as Record<string, string> | undefined;
      expect(meta?.robots).toContain("index");
      expect(meta?.robots).not.toContain("noindex");
      expect(meta?.canonical).toContain("/privacy");
    });
  });

  describe("terms of service", () => {
    it("should serve terms of service to anyone who asks for them", async () => {
      // Given a visitor who follows the Terms link in the footer
      // When they request the page
      const response = await app.inject({ method: "GET", url: "/terms" });

      // Then the terms are actually there to be read before they sign up
      expect(response.statusCode).toBe(200);
    });

    it("should tell the reader when the terms last changed", async () => {
      // When the terms render
      await app.inject({ method: "GET", url: "/terms" });

      // Then they carry an effective date, so a later amendment can be shown
      // to post-date the version a customer accepted
      expect(rendered?.data.lastUpdated).toBeTruthy();
    });

    it("should let search engines index the terms", async () => {
      // When the terms render
      await app.inject({ method: "GET", url: "/terms" });

      // Then they are indexable and self-canonical
      const meta = rendered?.data.meta as Record<string, string> | undefined;
      expect(meta?.robots).toContain("index");
      expect(meta?.robots).not.toContain("noindex");
      expect(meta?.canonical).toContain("/terms");
    });
  });

  it("should serve the legal pages without requiring a login", async () => {
    // Given no session cookie at all
    // When each legal page is requested
    const privacy = await app.inject({ method: "GET", url: "/privacy" });
    const terms = await app.inject({ method: "GET", url: "/terms" });

    // Then both render rather than redirecting to sign-in. Terms a visitor
    // must log in to read cannot bind them at the moment they sign up.
    expect(privacy.statusCode).toBe(200);
    expect(terms.statusCode).toBe(200);
  });
});
