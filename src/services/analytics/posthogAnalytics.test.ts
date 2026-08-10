import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { ANONYMOUS_DISTINCT_ID, PostHogAnalytics } from "./posthogAnalytics";
import { FakePostHogClient } from "./fakes";

describe("PostHogAnalytics", () => {
  describe("track", () => {
    it("should send the event to PostHog under the acting user when tracked", () => {
      // Given a PostHog sink
      const client = new FakePostHogClient();
      const analytics = new PostHogAnalytics(client);
      const userId = new ObjectId().toString();

      // When a user causes an event
      analytics.track(
        "service_created",
        { provider: "github" },
        { distinctId: userId },
      );

      // Then PostHog receives it attributed to that user
      expect(client.captured).toHaveLength(1);
      expect(client.captured[0].event).toBe("service_created");
      expect(client.captured[0].distinctId).toBe(userId);
      expect(client.captured[0].properties?.provider).toBe("github");
    });

    it("should attribute the event to the tenant when the context carries an account", () => {
      // Given a PostHog sink
      const client = new FakePostHogClient();
      const analytics = new PostHogAnalytics(client);
      const accountId = new ObjectId().toString();

      // When an event is tracked for an account
      analytics.track("api_key_created", {}, { accountId, distinctId: "u1" });

      // Then the account is reported so usage can be read per tenant
      expect(client.captured[0].groups?.account).toBe(accountId);
      expect(client.captured[0].properties?.accountId).toBe(accountId);
    });

    it("should send the event under an anonymous id when no actor is known", () => {
      // Given a PostHog sink
      const client = new FakePostHogClient();
      const analytics = new PostHogAnalytics(client);

      // When an event with no actor is tracked
      analytics.track("waitlist_signup");

      // Then it is still delivered, under the anonymous identity
      expect(client.captured[0].distinctId).toBe(ANONYMOUS_DISTINCT_ID);
    });

    it("should keep the caller's timestamp when an event is backdated", () => {
      // Given a PostHog sink
      const client = new FakePostHogClient();
      const analytics = new PostHogAnalytics(client);
      const when = new Date("2026-01-01T00:00:00.000Z");

      // When a backfilled event is tracked
      analytics.track("user_signed_up", {}, { timestamp: when });

      // Then PostHog records it at the original time, not at import time
      expect(client.captured[0].timestamp).toEqual(when);
    });
  });

  describe("identify", () => {
    it("should bind the traits to the user when identified", () => {
      // Given a PostHog sink
      const client = new FakePostHogClient();
      const analytics = new PostHogAnalytics(client);
      const userId = new ObjectId().toString();

      // When a user is identified
      analytics.identify(userId, { email: "sam@example.com" });

      // Then PostHog knows the person behind the id
      expect(client.identified).toHaveLength(1);
      expect(client.identified[0].distinctId).toBe(userId);
      expect(client.identified[0].properties?.email).toBe("sam@example.com");
    });

    it("should identify the subject rather than the context actor", () => {
      // Given a PostHog sink
      const client = new FakePostHogClient();
      const analytics = new PostHogAnalytics(client);

      // When a user is identified while the context names a visitor
      analytics.identify("user-1", {}, { distinctId: "visitor-9" });

      // Then the identified person is the subject of the call
      expect(client.identified[0].distinctId).toBe("user-1");
    });
  });

  describe("navigation", () => {
    it("should record the destination as an event when a screen is reached", () => {
      // Given a PostHog sink
      const client = new FakePostHogClient();
      const analytics = new PostHogAnalytics(client);

      // When navigation is recorded
      analytics.navigation("plan_selection", {}, { distinctId: "u1" });

      // Then the destination arrives as a distinguishable navigation event
      expect(client.captured[0].event).toBe("plan_selection");
      expect(client.captured[0].properties?.type).toBe("navigation");
    });
  });

  describe("resilience", () => {
    it("should not break the caller when PostHog fails", () => {
      // Given a PostHog client that throws on every call
      const client = new FakePostHogClient();
      client.failWith = new Error("posthog is down");
      const errors: unknown[] = [];
      const analytics = new PostHogAnalytics(client, (e) => errors.push(e));

      // When events are emitted
      // Then the request path is unaffected
      expect(() => analytics.track("service_created")).not.toThrow();
      expect(() => analytics.identify("u1", {})).not.toThrow();
      expect(() => analytics.navigation("plan_selection")).not.toThrow();
      expect(errors).toHaveLength(3);
    });
  });

  describe("flush", () => {
    it("should push buffered events out when flushed", async () => {
      // Given a PostHog sink with a buffered client
      const client = new FakePostHogClient();
      const analytics = new PostHogAnalytics(client);

      // When the sink is flushed
      analytics.track("service_created");
      await analytics.flush();

      // Then the client was told to deliver what it is holding
      expect(client.flushes).toBe(1);
    });

    it("should not reject when flushing fails", async () => {
      // Given a PostHog client that cannot reach the network
      const client = new FakePostHogClient();
      client.failWith = new Error("offline");
      const analytics = new PostHogAnalytics(client, () => {});

      // When the sink is flushed
      // Then shutdown of the app is not blocked by it
      await expect(analytics.flush()).resolves.toBeUndefined();
    });
  });
});
