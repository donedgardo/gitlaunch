import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { ObjectId } from "mongodb";
import { sessionAuthMiddleware } from "./sessionAuth";
import { SessionService } from "../../services/auth/sessionService";

describe("sessionAuthMiddleware", () => {
  let app: FastifyInstance;
  let sessionService: SessionService;
  const secret = "test-secret";

  beforeEach(async () => {
    sessionService = new SessionService(secret);
    app = Fastify();
    await app.register(cookie);

    // Register the middleware
    sessionAuthMiddleware(app, sessionService);

    // Test route that requires auth
    app.get("/protected", async (request, reply) => {
      if (!request.session) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      return {
        userId: request.session.userId,
        accountId: request.session.accountId,
      };
    });

    // Test route that checks redirect behavior
    app.get("/dashboard", async (request, reply) => {
      if (!request.session) {
        return reply.redirect("/");
      }
      return { message: "Welcome to dashboard" };
    });

    await app.ready();
  });

  describe("request with valid session cookie", () => {
    it("should attach session to request", async () => {
      // Given: a valid session token
      const userId = new ObjectId();
      const accountId = new ObjectId();
      const token = sessionService.createSession({ userId, accountId });

      // When: I make a request with the session cookie
      const response = await app.inject({
        method: "GET",
        url: "/protected",
        cookies: { session: token },
      });

      // Then: the request has session attached and succeeds
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.userId).toBe(userId.toString());
      expect(body.accountId).toBe(accountId.toString());
    });
  });

  describe("request without session cookie", () => {
    it("should not attach session to request", async () => {
      // When: I make a request without a session cookie
      const response = await app.inject({
        method: "GET",
        url: "/protected",
      });

      // Then: the request has no session (route returns 401)
      expect(response.statusCode).toBe(401);
    });

    it("should allow route to redirect to login", async () => {
      // When: I make a request to dashboard without session
      const response = await app.inject({
        method: "GET",
        url: "/dashboard",
      });

      // Then: I'm redirected to home/login
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/");
    });
  });

  describe("request with invalid session cookie", () => {
    it("should not attach session for malformed token", async () => {
      // When: I make a request with garbage token
      const response = await app.inject({
        method: "GET",
        url: "/protected",
        cookies: { session: "invalid-token" },
      });

      // Then: the request has no session
      expect(response.statusCode).toBe(401);
    });

    it("should not attach session for expired token", async () => {
      // Given: an expired token (using a short-lived service)
      const shortLivedService = new SessionService(secret, {
        expiresInSeconds: 1,
      });
      const token = shortLivedService.createSession({
        userId: new ObjectId(),
        accountId: new ObjectId(),
      });

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // When: I make a request with expired token
      const response = await app.inject({
        method: "GET",
        url: "/protected",
        cookies: { session: token },
      });

      // Then: the request has no session
      expect(response.statusCode).toBe(401);
    });
  });

  describe("request with Authorization header", () => {
    it("should accept Bearer token in Authorization header", async () => {
      // Given: a valid session token
      const userId = new ObjectId();
      const accountId = new ObjectId();
      const token = sessionService.createSession({ userId, accountId });

      // When: I make a request with Authorization header
      const response = await app.inject({
        method: "GET",
        url: "/protected",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      // Then: the request succeeds with session attached
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.userId).toBe(userId.toString());
    });
  });
});
