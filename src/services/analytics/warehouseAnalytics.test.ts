import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AnalyticsEventRepository } from "../../repositories/analyticsEventRepository";
import { WarehouseAnalytics } from "./warehouseAnalytics";

// Let the fire-and-forget insert settle before asserting.
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("WarehouseAnalytics", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: AnalyticsEventRepository;
  let analytics: WarehouseAnalytics;

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
    analytics = new WarehouseAnalytics(repo);
  });

  it("should persist a track event with tenant and actor from context", async () => {
    // When: I track an event with context
    analytics.track(
      "deployment_triggered",
      { environment: "prod" },
      { accountId: accountId.toString(), distinctId: "user-9" },
    );
    await settle();

    // Then: the event is persisted, scoped to the account, with the actor
    const events = await repo.findByAccount(accountId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("track");
    expect(events[0].event).toBe("deployment_triggered");
    expect(events[0].distinctId).toBe("user-9");
    expect(events[0].properties).toEqual({ environment: "prod" });
  });

  it("should persist an identify event with the user as distinctId", async () => {
    // When: I identify a user
    analytics.identify(
      "user-42",
      { plan: "pro" },
      { accountId: accountId.toString() },
    );
    await settle();

    // Then: an identify event is stored keyed on the user
    const events = await repo.findByAccount(accountId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("identify");
    expect(events[0].event).toBe("user-42");
    expect(events[0].distinctId).toBe("user-42");
    expect(events[0].properties).toEqual({ plan: "pro" });
  });

  it("should persist a navigation event", async () => {
    // When: I record a navigation
    analytics.navigation(
      "/dashboard",
      { from: "/" },
      { accountId: accountId.toString(), distinctId: "user-1" },
    );
    await settle();

    // Then: a navigation event is stored with the destination
    const events = await repo.findByAccount(accountId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("navigation");
    expect(events[0].event).toBe("/dashboard");
  });

  it("should not throw when persistence fails, and report the error", async () => {
    // Given: a repository whose insert always fails
    const errors: unknown[] = [];
    const failingRepo = {
      insert: async () => {
        throw new Error("mongo down");
      },
    } as unknown as AnalyticsEventRepository;
    const resilient = new WarehouseAnalytics(failingRepo, (e) =>
      errors.push(e),
    );

    // When: I track an event (fire-and-forget)
    // Then: the call itself does not throw
    expect(() =>
      resilient.track("x", {}, { accountId: accountId.toString() }),
    ).not.toThrow();

    await settle();

    // And: the failure was captured, not swallowed silently into an
    // unhandled rejection
    expect(errors).toHaveLength(1);
  });
});
