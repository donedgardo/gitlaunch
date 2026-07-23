import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AnalyticsEventRepository } from "./analyticsEventRepository";

describe("AnalyticsEventRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: AnalyticsEventRepository;

  const accountId = new ObjectId();

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new AnalyticsEventRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("analytics_events").deleteMany({});
  });

  describe("insert", () => {
    it("should persist a track event with all fields", async () => {
      // Given: a track event for an account and actor
      const timestamp = new Date("2026-07-01T12:00:00Z");

      // When: I insert the event
      const event = await repo.insert({
        type: "track",
        event: "deployment_triggered",
        accountId,
        distinctId: "user-123",
        properties: { serviceId: "svc-1", environment: "prod" },
        timestamp,
      });

      // Then: I get back a stored event with all fields
      expect(event._id).toBeDefined();
      expect(event.type).toBe("track");
      expect(event.event).toBe("deployment_triggered");
      expect(event.accountId!.toString()).toBe(accountId.toString());
      expect(event.distinctId).toBe("user-123");
      expect(event.properties).toEqual({
        serviceId: "svc-1",
        environment: "prod",
      });
      expect(event.timestamp).toEqual(timestamp);
    });

    it("should default properties to empty object and timestamp to now", async () => {
      // Given: a minimal event with no properties or timestamp
      const before = Date.now();

      // When: I insert it
      const event = await repo.insert({
        type: "track",
        event: "user_logged_in",
        accountId,
      });

      // Then: properties defaults to {} and timestamp is set to ~now
      expect(event.properties).toEqual({});
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("should allow events with no account (pre-login)", async () => {
      // Given: an event with no accountId
      // When: I insert it
      const event = await repo.insert({
        type: "navigation",
        event: "/pricing",
      });

      // Then: it is stored with no accountId
      expect(event._id).toBeDefined();
      expect(event.accountId).toBeUndefined();
    });
  });

  describe("findByAccount", () => {
    it("should return an account's events sorted newest first", async () => {
      // Given: two events for the account at different times
      await repo.insert({
        type: "track",
        event: "first",
        accountId,
        timestamp: new Date("2026-07-01T00:00:00Z"),
      });
      await repo.insert({
        type: "track",
        event: "second",
        accountId,
        timestamp: new Date("2026-07-02T00:00:00Z"),
      });

      // When: I list the account's events
      const events = await repo.findByAccount(accountId);

      // Then: they come back newest first
      expect(events).toHaveLength(2);
      expect(events[0].event).toBe("second");
      expect(events[1].event).toBe("first");
    });

    it("should enforce tenant isolation - not return another account's events", async () => {
      // Given: events for two different accounts
      const accountA = new ObjectId();
      const accountB = new ObjectId();
      await repo.insert({
        type: "track",
        event: "a-event",
        accountId: accountA,
      });
      await repo.insert({
        type: "track",
        event: "b-event",
        accountId: accountB,
      });

      // When: account A lists its events
      const events = await repo.findByAccount(accountA);

      // Then: only account A's events are returned
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("a-event");
    });
  });

  describe("ensureIndexes", () => {
    it("should be idempotent - calling multiple times succeeds", async () => {
      // When: I call ensureIndexes multiple times
      await repo.ensureIndexes();
      await repo.ensureIndexes();

      // Then: the expected indexes exist
      const indexes = await db.collection("analytics_events").indexes();
      expect(indexes.length).toBeGreaterThanOrEqual(3); // _id + 2 custom
    });
  });
});
