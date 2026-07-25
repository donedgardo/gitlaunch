import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance, FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import homeRoute from "./index";

// Captures what the landing page was rendered with, so we can assert on the
// signals the route passes to the view without a Handlebars setup.
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

describe("home route", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    rendered = null;
    app = Fastify();
    await app.register(cookie, { secret: "cookie-secret" });
    await app.register(capturingViewPlugin);
    await app.register(homeRoute());
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("should tell a turned-away visitor that signups are closed", async () => {
    // Given a visitor bounced off the sign-in flow because signups are closed
    // When they land back on the marketing page
    const response = await app.inject({
      method: "GET",
      url: "/?error=signups_closed",
    });

    // Then the page knows to explain that, and point them at the waitlist
    expect(response.statusCode).toBe(200);
    expect(rendered?.data.signupsClosed).toBe(true);
  });

  it("should not mention closed signups on a normal visit", async () => {
    // When an ordinary visitor lands on the marketing page
    const response = await app.inject({ method: "GET", url: "/" });

    // Then nothing is said about signups being closed
    expect(response.statusCode).toBe(200);
    expect(rendered?.data.signupsClosed).toBeFalsy();
  });

  it("should give the landing page rich sharing metadata", async () => {
    // When the public marketing page renders
    await app.inject({ method: "GET", url: "/" });

    // Then it carries OpenGraph metadata so the URL unfurls into a card when
    // shared, rather than showing a bare link
    const meta = rendered?.data.meta as Record<string, string> | undefined;
    expect(meta).toBeTruthy();
    expect(meta?.ogTitle).toContain("GitLaunch");
    expect(meta?.ogDescription?.length ?? 0).toBeGreaterThan(0);
    expect(meta?.ogImage).toContain("og-image");
    expect(meta?.twitterCard).toBe("summary_large_image");
    // The landing page is the canonical site root
    expect(meta?.canonical).toBeTruthy();
  });

  describe("A/B visitor cookie", () => {
    // ePrivacy Art. 5(3) requires consent for any storage that is not strictly
    // necessary to deliver the page, and bucketing a visitor into a copy
    // variant is not. We do not gate the landing page behind a consent banner,
    // so we keep the exposure proportionate instead: the cookie lives only as
    // long as the experiment needs to read it.
    const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;

    it("should not retain an anonymous visitor beyond the experiment window", async () => {
      // When a first-time visitor lands on the marketing page
      const response = await app.inject({ method: "GET", url: "/" });

      // Then the id we assign them expires within a month, rather than
      // tracking them for a year for a test that concluded long before
      const visitorCookie = response.cookies.find(
        (c: any) => c.name === "gl_vid",
      );
      expect(visitorCookie).toBeTruthy();
      expect(visitorCookie?.maxAge).toBeLessThanOrEqual(THIRTY_DAYS_IN_SECONDS);
    });

    it("should keep an anonymous visitor out of reach of page scripts", async () => {
      // When a first-time visitor lands on the marketing page
      const response = await app.inject({ method: "GET", url: "/" });

      // Then the id is httpOnly, so it cannot be read and correlated by any
      // script that later ends up on the page
      const visitorCookie = response.cookies.find(
        (c: any) => c.name === "gl_vid",
      );
      expect(visitorCookie?.httpOnly).toBe(true);
    });
  });

  describe("login call-to-action", () => {
    // A door that answers however the test wants, standing in for the flag.
    const doorThatSays = (allowed: boolean) => ({
      allows: async () => ({ allowed, reason: "test", variant: null }),
    });

    const start = async (deps: Parameters<typeof homeRoute>[0]) => {
      await app.close();
      rendered = null;
      app = Fastify();
      await app.register(cookie, { secret: "cookie-secret" });
      await app.register(capturingViewPlugin);
      await app.register(homeRoute(deps));
      await app.ready();
    };

    it("should offer an ordinary login when signups are open", async () => {
      // Given the front door is open
      await start({ signupDoor: doorThatSays(true) });

      // When a visitor lands on the marketing page
      await app.inject({ method: "GET", url: "/" });

      // Then the page invites them to log in as usual
      expect(rendered?.data.signupsOpen).toBe(true);
    });

    it("should mark login as existing-accounts-only when signups are closed", async () => {
      // Given the front door is shut to new accounts
      await start({ signupDoor: doorThatSays(false) });

      // When a visitor lands on the marketing page
      await app.inject({ method: "GET", url: "/" });

      // Then the page still shows a way in, but says who it is for — an
      // existing customer must never lose their route to sign in.
      expect(rendered?.data.signupsOpen).toBe(false);
    });

    it("should invite login when no door is configured", async () => {
      // Given nothing is wired up to answer (the self-flag setup is inert)
      await start({});

      // When a visitor lands on the marketing page
      await app.inject({ method: "GET", url: "/" });

      // Then we fail open, exactly as the signup gate itself does
      expect(rendered?.data.signupsOpen).toBe(true);
    });
  });
});
