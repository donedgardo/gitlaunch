import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AnalyticsEventRepository } from "../../repositories/analyticsEventRepository";
import { AnalyticsQueryService } from "./analyticsQueryService";

describe("AnalyticsQueryService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: AnalyticsEventRepository;
  let query: AnalyticsQueryService;

  const accountId = new ObjectId();
  const otherAccountId = new ObjectId();

  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-08T00:00:00Z");

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new AnalyticsEventRepository(db);
    query = new AnalyticsQueryService(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("analytics_events").deleteMany({});
  });

  async function seed(
    event: string,
    timestamp: string,
    opts: {
      account?: ObjectId;
      distinctId?: string;
      properties?: Record<string, any>;
    } = {},
  ) {
    await repo.insert({
      type: "track",
      event,
      accountId: opts.account ?? accountId,
      distinctId: opts.distinctId,
      properties: opts.properties,
      timestamp: new Date(timestamp),
    });
  }

  describe("eventVolume", () => {
    it("should bucket event counts by day", async () => {
      // Given: 2 events on Jul 2 and 1 event on Jul 3
      await seed("deploy", "2026-07-02T09:00:00Z");
      await seed("deploy", "2026-07-02T18:00:00Z");
      await seed("deploy", "2026-07-03T10:00:00Z");

      // When: I ask for daily volume
      const series = await query.eventVolume({
        accountId,
        from,
        to,
        interval: "day",
      });

      // Then: I get one bucket per active day with correct counts
      const map = Object.fromEntries(
        series.map((p) => [p.bucket.toISOString(), p.count]),
      );
      expect(map["2026-07-02T00:00:00.000Z"]).toBe(2);
      expect(map["2026-07-03T00:00:00.000Z"]).toBe(1);
    });

    it("should filter to a single event name when provided", async () => {
      // Given: mixed events on the same day
      await seed("deploy", "2026-07-02T09:00:00Z");
      await seed("login", "2026-07-02T10:00:00Z");

      // When: I ask for volume of "deploy" only
      const series = await query.eventVolume({
        accountId,
        event: "deploy",
        from,
        to,
        interval: "day",
      });

      // Then: only deploy events are counted
      const total = series.reduce((sum, p) => sum + p.count, 0);
      expect(total).toBe(1);
    });

    it("should exclude events outside the time range", async () => {
      // Given: an event before the range
      await seed("deploy", "2026-06-30T09:00:00Z");
      await seed("deploy", "2026-07-02T09:00:00Z");

      // When: I ask for volume within the range
      const series = await query.eventVolume({
        accountId,
        from,
        to,
        interval: "day",
      });

      // Then: only the in-range event counts
      const total = series.reduce((sum, p) => sum + p.count, 0);
      expect(total).toBe(1);
    });

    it("should not include another account's events", async () => {
      // Given: events for two accounts
      await seed("deploy", "2026-07-02T09:00:00Z");
      await seed("deploy", "2026-07-02T09:00:00Z", {
        account: otherAccountId,
      });

      // When: I ask for this account's volume
      const series = await query.eventVolume({
        accountId,
        from,
        to,
        interval: "day",
      });

      // Then: only this account's event counts
      const total = series.reduce((sum, p) => sum + p.count, 0);
      expect(total).toBe(1);
    });
  });

  describe("uniqueUsers", () => {
    it("should count distinct actors in the range", async () => {
      // Given: two distinct users, one acting twice
      await seed("deploy", "2026-07-02T09:00:00Z", { distinctId: "u1" });
      await seed("deploy", "2026-07-02T10:00:00Z", { distinctId: "u1" });
      await seed("deploy", "2026-07-03T10:00:00Z", { distinctId: "u2" });

      // When: I ask for unique users
      const count = await query.uniqueUsers({ accountId, from, to });

      // Then: distinct actors are counted once
      expect(count).toBe(2);
    });
  });

  describe("topEvents", () => {
    it("should return event names by count descending", async () => {
      // Given: deploy x3, login x1
      await seed("deploy", "2026-07-02T09:00:00Z");
      await seed("deploy", "2026-07-02T10:00:00Z");
      await seed("deploy", "2026-07-03T10:00:00Z");
      await seed("login", "2026-07-03T11:00:00Z");

      // When: I ask for the top events
      const top = await query.topEvents({ accountId, from, to, limit: 10 });

      // Then: deploy leads, login follows
      expect(top[0]).toEqual({ event: "deploy", count: 3 });
      expect(top[1]).toEqual({ event: "login", count: 1 });
    });

    it("should respect the limit", async () => {
      await seed("a", "2026-07-02T09:00:00Z");
      await seed("b", "2026-07-02T09:00:00Z");
      await seed("c", "2026-07-02T09:00:00Z");

      const top = await query.topEvents({ accountId, from, to, limit: 2 });
      expect(top).toHaveLength(2);
    });
  });

  describe("breakdownBy", () => {
    it("should group counts by a property value", async () => {
      // Given: deploys to prod x2 and staging x1
      await seed("deploy", "2026-07-02T09:00:00Z", {
        properties: { environment: "prod" },
      });
      await seed("deploy", "2026-07-02T10:00:00Z", {
        properties: { environment: "prod" },
      });
      await seed("deploy", "2026-07-03T10:00:00Z", {
        properties: { environment: "staging" },
      });

      // When: I break deploys down by environment
      const breakdown = await query.breakdownBy({
        accountId,
        event: "deploy",
        property: "environment",
        from,
        to,
      });

      // Then: I get per-value counts, descending
      const map = Object.fromEntries(breakdown.map((b) => [b.value, b.count]));
      expect(map["prod"]).toBe(2);
      expect(map["staging"]).toBe(1);
    });
  });
});
