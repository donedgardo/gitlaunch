import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AnalyticsEventRepository } from "../../repositories/analyticsEventRepository";
import { createAnalyticsService } from "./createAnalyticsService";

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
});
