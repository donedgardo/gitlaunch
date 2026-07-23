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
});
