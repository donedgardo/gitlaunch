import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { WebhookEventRepository } from "./webhookEventRepository";

describe("WebhookEventRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: WebhookEventRepository;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new WebhookEventRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clean up between tests
    await db.collection("webhookEvents").deleteMany({});
  });

  describe("markAsProcessed", () => {
    it("should return true when processing an event for the first time", async () => {
      // Given: no events have been processed
      // When: I mark event "evt_abc123" as processed
      const result = await repo.markAsProcessed(
        "evt_abc123",
        "checkout.session.completed",
        { session: "data" },
      );

      // Then: it returns true
      expect(result).toBe(true);
    });

    it("should return false when processing the same event a second time", async () => {
      // Given: event "evt_abc123" has already been processed
      await repo.markAsProcessed("evt_abc123", "checkout.session.completed", {
        session: "data",
      });

      // When: I try to mark "evt_abc123" as processed again
      const result = await repo.markAsProcessed(
        "evt_abc123",
        "checkout.session.completed",
        { session: "data" },
      );

      // Then: it returns false (duplicate detected)
      expect(result).toBe(false);
    });

    it("should store event metadata (type, processedAt, payload)", async () => {
      // Given: I process event "evt_xyz789" of type "checkout.session.completed"
      await repo.markAsProcessed("evt_xyz789", "checkout.session.completed", {
        session: "data",
      });

      // When: I look up the stored event
      const storedEvent = await db
        .collection("webhookEvents")
        .findOne({ stripeEventId: "evt_xyz789" });

      // Then: it has stripeEventId, eventType, processedAt (Date), and payload
      expect(storedEvent).not.toBeNull();
      expect(storedEvent!.stripeEventId).toBe("evt_xyz789");
      expect(storedEvent!.eventType).toBe("checkout.session.completed");
      expect(storedEvent!.processedAt).toBeInstanceOf(Date);
      expect(storedEvent!.payload).toEqual({ session: "data" });
    });

    it("should allow different event IDs to be processed independently", async () => {
      // Given: event "evt_first" has been processed
      await repo.markAsProcessed("evt_first", "payment_intent.succeeded", {
        amount: 1000,
      });

      // When: I mark event "evt_second" as processed
      const result = await repo.markAsProcessed(
        "evt_second",
        "invoice.payment_succeeded",
        { invoice: "data" },
      );

      // Then: it returns true (different event, not a duplicate)
      expect(result).toBe(true);
    });
  });

  describe("ensureIndexes", () => {
    it("should create a unique index on stripeEventId", async () => {
      // Given: a fresh repository
      // When: I call ensureIndexes
      await repo.ensureIndexes();

      // Then: the webhookEvents collection has a unique index on stripeEventId
      const indexes = await db.collection("webhookEvents").indexes();
      const uniqueIndex = indexes.find(
        (idx) => idx.key.stripeEventId === 1 && idx.unique === true,
      );

      expect(uniqueIndex).toBeDefined();
      expect(uniqueIndex!.unique).toBe(true);
    });
  });
});
