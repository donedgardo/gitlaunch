import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AnalyticsEventRepository } from "../../repositories/analyticsEventRepository";
import { ExperimentResultsService } from "./experimentResultsService";

describe("ExperimentResultsService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: AnalyticsEventRepository;
  let results: ExperimentResultsService;

  const accountId = new ObjectId();
  const otherAccountId = new ObjectId();
  const serviceId = new ObjectId();

  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-08T00:00:00Z");

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new AnalyticsEventRepository(db);
    results = new ExperimentResultsService(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("analytics_events").deleteMany({});
  });

  async function exposure(
    variant: string | null,
    distinctId: string,
    opts: {
      account?: ObjectId;
      flagKey?: string;
      environment?: string;
      timestamp?: string;
    } = {},
  ) {
    await repo.insert({
      type: "track",
      event: "flag_exposure",
      accountId: opts.account ?? accountId,
      distinctId,
      properties: {
        serviceId: serviceId.toString(),
        flagKey: opts.flagKey ?? "new-checkout",
        environment: opts.environment ?? "prod",
        variant,
      },
      timestamp: new Date(opts.timestamp ?? "2026-07-03T12:00:00Z"),
    });
  }

  async function conversion(
    variant: string | null,
    distinctId: string,
    opts: {
      account?: ObjectId;
      flagKey?: string;
      environment?: string;
      timestamp?: string;
    } = {},
  ) {
    await repo.insert({
      type: "track",
      event: "flag_conversion",
      accountId: opts.account ?? accountId,
      distinctId,
      properties: {
        serviceId: serviceId.toString(),
        flagKey: opts.flagKey ?? "new-checkout",
        environment: opts.environment ?? "prod",
        variant,
      },
      timestamp: new Date(opts.timestamp ?? "2026-07-03T13:00:00Z"),
    });
  }

  function query(overrides: Record<string, unknown> = {}) {
    return {
      accountId,
      serviceId,
      flagKey: "new-checkout",
      environment: "prod",
      from,
      to,
      ...overrides,
    };
  }

  it("should count unique exposures and conversions per variant and compute rate", async () => {
    // control: 2 exposed, 1 converted => 0.5
    await exposure("control", "u1");
    await exposure("control", "u2");
    await conversion("control", "u1");
    // treatment: 2 exposed, 2 converted => 1.0
    await exposure("treatment", "u3");
    await exposure("treatment", "u4");
    await conversion("treatment", "u3");
    await conversion("treatment", "u4");

    const res = await results.getResults(query());

    const byVariant = Object.fromEntries(
      res.variants.map((v) => [v.variant, v]),
    );
    expect(byVariant["control"]).toMatchObject({
      exposures: 2,
      conversions: 1,
      conversionRate: 0.5,
    });
    expect(byVariant["treatment"]).toMatchObject({
      exposures: 2,
      conversions: 2,
      conversionRate: 1,
    });
    expect(res.totals).toMatchObject({ exposures: 4, conversions: 3 });
  });

  it("should count a repeat-exposed entity once (unique by distinctId)", async () => {
    await exposure("control", "u1");
    await exposure("control", "u1");
    await exposure("control", "u1");
    await conversion("control", "u1");
    await conversion("control", "u1");

    const res = await results.getResults(query());
    const control = res.variants.find((v) => v.variant === "control")!;
    expect(control.exposures).toBe(1);
    expect(control.conversions).toBe(1);
    expect(control.conversionRate).toBe(1);
  });

  it("should report a zero conversion rate when nobody converts", async () => {
    await exposure("control", "u1");
    await exposure("control", "u2");

    const res = await results.getResults(query());
    const control = res.variants.find((v) => v.variant === "control")!;
    expect(control.exposures).toBe(2);
    expect(control.conversions).toBe(0);
    expect(control.conversionRate).toBe(0);
  });

  it("should isolate results by account, service, flag, environment and time range", async () => {
    await exposure("control", "u1");
    // other account
    await exposure("control", "x1", { account: otherAccountId });
    // other flag
    await exposure("control", "y1", { flagKey: "other-flag" });
    // other environment
    await exposure("control", "z1", { environment: "staging" });
    // outside time range
    await exposure("control", "old", { timestamp: "2026-06-01T00:00:00Z" });

    const res = await results.getResults(query());
    expect(res.totals.exposures).toBe(1);
    expect(res.variants).toHaveLength(1);
    expect(res.variants[0].variant).toBe("control");
  });

  it("should represent a null variant (boolean rollout) as a labelled group", async () => {
    await exposure(null, "u1");
    await conversion(null, "u1");

    const res = await results.getResults(query());
    expect(res.variants).toHaveLength(1);
    expect(res.variants[0].variant).toBe("(control)");
    expect(res.variants[0].conversions).toBe(1);
  });
});
