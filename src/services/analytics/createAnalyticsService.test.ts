import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AnalyticsEventRepository } from "../../repositories/analyticsEventRepository";
import { createAnalyticsService } from "./createAnalyticsService";
import { FakePostHogClient } from "./fakes";

const tick = () => new Promise((r) => setTimeout(r, 10));

// Poll until the account has at least `min` events, or give up. Robust against
// the fire-and-forget write completing slightly later under load.
async function waitForEventCount(
  repo: AnalyticsEventRepository,
  accountId: ObjectId,
  min: number,
): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const events = await repo.findByAccount(accountId);
    if (events.length >= min) return events.length;
    await tick();
  }
  return (await repo.findByAccount(accountId)).length;
}

describe("createAnalyticsService", () => {
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

  it("should persist events to the warehouse when warehouse is enabled", async () => {
    // Given: analytics configured with the warehouse enabled
    const analytics = createAnalyticsService(repo, { warehouse: true });

    // When: an event is tracked
    analytics.track("thing_happened", {}, { accountId: accountId.toString() });

    // Then: it lands in the warehouse
    const count = await waitForEventCount(repo, accountId, 1);
    expect(count).toBe(1);
  });

  it("should not persist events when the warehouse is disabled", async () => {
    // Given: analytics configured without the warehouse
    const analytics = createAnalyticsService(repo, {
      warehouse: false,
      dev: true,
    });

    // When: an event is tracked
    analytics.track("thing_happened", {}, { accountId: accountId.toString() });
    await tick();

    // Then: nothing is written to the warehouse
    const events = await repo.findByAccount(accountId);
    expect(events).toHaveLength(0);
  });

  it("should send the same event to both destinations when the warehouse and PostHog are on", async () => {
    // Given: analytics configured with both destinations
    const posthog = new FakePostHogClient();
    const analytics = createAnalyticsService(repo, {
      warehouse: true,
      posthog,
    });

    // When: an event is tracked
    analytics.track("service_created", {}, { accountId: accountId.toString() });

    // Then: it lands in the warehouse and in PostHog
    const count = await waitForEventCount(repo, accountId, 1);
    expect(count).toBe(1);
    expect(posthog.captured[0].event).toBe("service_created");
  });

  it("should still reach PostHog when the warehouse is off", async () => {
    // Given: analytics with PostHog as the only destination
    const posthog = new FakePostHogClient();
    const analytics = createAnalyticsService(repo, {
      warehouse: false,
      posthog,
    });

    // When: an event is tracked
    analytics.track("service_created", {}, { accountId: accountId.toString() });
    await tick();

    // Then: PostHog got it and the warehouse stayed empty
    expect(posthog.captured).toHaveLength(1);
    expect(await repo.findByAccount(accountId)).toHaveLength(0);
  });

  it("should not log to the console when a real destination is configured", () => {
    // Given: a dev instance that also ships events to PostHog
    const logged: string[] = [];
    const analytics = createAnalyticsService(repo, {
      warehouse: false,
      dev: true,
      posthog: new FakePostHogClient(),
      log: (msg) => logged.push(msg),
    });

    // When: an event is tracked
    analytics.track("service_created");

    // Then: the console sink stays out of the way — it is the fallback for
    // having no destination at all, not an extra one.
    expect(logged).toHaveLength(0);
  });
});
