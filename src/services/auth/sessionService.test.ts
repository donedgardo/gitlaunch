import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SessionService } from "./sessionService";
import { ObjectId } from "mongodb";

describe("SessionService", () => {
  let service: SessionService;
  const secret = "test-secret-key-for-jwt-signing";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
    service = new SessionService(secret);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createSession", () => {
    it("should create a token that can be validated", async () => {
      // Given: user and account info
      const userId = new ObjectId();
      const accountId = new ObjectId();

      // When: I create a session
      const token = service.createSession({ userId, accountId });

      // Then: the token can be validated
      const session = service.validateSession(token);
      expect(session).not.toBeNull();
      expect(session!.userId).toBe(userId.toString());
      expect(session!.accountId).toBe(accountId.toString());
    });

    it("should return a JWT string", () => {
      // When: I create a session
      const token = service.createSession({
        userId: new ObjectId(),
        accountId: new ObjectId(),
      });

      // Then: it's a JWT (three dot-separated base64 parts)
      expect(token.split(".")).toHaveLength(3);
    });
  });

  describe("validateSession", () => {
    it("should return session data for valid token", () => {
      // Given: a valid token
      const userId = new ObjectId();
      const accountId = new ObjectId();
      const token = service.createSession({ userId, accountId });

      // When: I validate it
      const session = service.validateSession(token);

      // Then: I get session data
      expect(session).not.toBeNull();
      expect(session!.userId).toBe(userId.toString());
      expect(session!.accountId).toBe(accountId.toString());
    });

    it("should return null for expired token", () => {
      // Given: a token created now
      const token = service.createSession({
        userId: new ObjectId(),
        accountId: new ObjectId(),
      });

      // When: time passes beyond expiry (default 15 minutes)
      vi.advanceTimersByTime(16 * 60 * 1000); // 16 minutes

      // Then: validation returns null
      const session = service.validateSession(token);
      expect(session).toBeNull();
    });

    it("should return null for invalid token", () => {
      // When: I validate garbage
      const session = service.validateSession("invalid.token.here");

      // Then: I get null
      expect(session).toBeNull();
    });

    it("should return null for token signed with different secret", () => {
      // Given: a token from a different service with different secret
      const otherService = new SessionService("different-secret");
      const token = otherService.createSession({
        userId: new ObjectId(),
        accountId: new ObjectId(),
      });

      // When: I validate with my service
      const session = service.validateSession(token);

      // Then: I get null (signature mismatch)
      expect(session).toBeNull();
    });
  });

  describe("custom expiry", () => {
    it("should respect custom expiry time", () => {
      // Given: a service with 1 hour expiry
      const longService = new SessionService(secret, {
        expiresInSeconds: 3600,
      });
      const token = longService.createSession({
        userId: new ObjectId(),
        accountId: new ObjectId(),
      });

      // When: 30 minutes pass
      vi.advanceTimersByTime(30 * 60 * 1000);

      // Then: token is still valid
      const session = longService.validateSession(token);
      expect(session).not.toBeNull();

      // When: another 35 minutes pass (total 65 min > 60 min)
      vi.advanceTimersByTime(35 * 60 * 1000);

      // Then: token is expired
      const expiredSession = longService.validateSession(token);
      expect(expiredSession).toBeNull();
    });
  });
});
