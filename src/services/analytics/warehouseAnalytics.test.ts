import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AnalyticsEventRepository } from "../../repositories/analyticsEventRepository";
import { WarehouseAnalytics } from "./warehouseAnalytics";

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
    await analytics.flush();

    // Then: the event is persisted, scoped to the account, with the actor
    const events = await repo.findByAccount(accountId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("track");
    expect(events[0].event).toBe("deployment_triggered");
    expect(events[0].distinctId).toBe("user-9");
    expect(events[0].properties).toEqual({ environment: "prod" });
  });

  it("should persist an identify event under a stable event name, keyed on the user", async () => {
    // When: I identify a user
    analytics.identify(
      "user-42",
      { plan: "pro" },
      { accountId: accountId.toString() },
    );
    await analytics.flush();

    // Then: an identify event is stored under the stable "$identify" name,
    // with the user carried only in distinctId (not overloaded into `event`)
    const events = await repo.findByAccount(accountId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("identify");
    expect(events[0].event).toBe("$identify");
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
    await analytics.flush();

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

    await resilient.flush();

    // And: the failure was captured, not swallowed silently into an
    // unhandled rejection
    expect(errors).toHaveLength(1);
  });
});
