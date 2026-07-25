import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AnalyticsEventRepository } from "../../repositories/analyticsEventRepository";
import { InsightsService } from "./insightsService";

describe("InsightsService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: AnalyticsEventRepository;
  let insights: InsightsService;

  const accountId = new ObjectId();
  const serviceId = new ObjectId();

  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-08T00:00:00Z");

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new AnalyticsEventRepository(db);
    insights = new InsightsService(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("analytics_events").deleteMany({});
    await db.collection("leads").deleteMany({});
  });

  async function exposure(
    variant: string,
    distinctId: string,
    options: { at?: string; environment?: string; flagKey?: string } = {},
  ) {
    await repo.insert({
      type: "track",
      event: "flag_exposure",
      timestamp: new Date(options.at ?? "2026-07-02T10:00:00Z"),
      distinctId,
      accountId,
      properties: {
        serviceId: serviceId.toString(),
        flagKey: options.flagKey ?? "waitlist-hero-copy",
        environment: options.environment ?? "prod",
        variant,
        reason: "variant",
      },
    });
  }

  async function signup(
    options: { at?: string; accountId?: ObjectId; campaign?: string } = {},
  ) {
    await repo.insert({
      type: "track",
      event: "waitlist_signup",
      timestamp: new Date(options.at ?? "2026-07-02T10:00:00Z"),
      distinctId: new ObjectId().toString(),
      accountId: options.accountId,
      properties: { campaign: options.campaign ?? null, source: null },
    });
  }

  describe("build", () => {
    it("should discover the experiments that actually ran in the window", async () => {
      // Given exposures for two flags in the window
      await exposure("control", "visitor-1");
      await exposure("benefit-led", "visitor-2");
      await exposure("control", "visitor-3", { flagKey: "other-experiment" });

      // When I build the report
      const report = await insights.build({ from, to });

      // Then both experiments are reported
      expect(report.experiments.map((e) => e.flagKey).sort()).toEqual([
        "other-experiment",
        "waitlist-hero-copy",
      ]);
    });

    it("should report each environment of an experiment separately", async () => {
      // Given the same flag exposed in two environments
      await exposure("control", "visitor-1", { environment: "prod" });
      await exposure("control", "visitor-2", { environment: "dev" });

      // When I build the report
      const report = await insights.build({ from, to });

      // Then each environment is analysed on its own
      expect(report.experiments.map((e) => e.environment).sort()).toEqual([
        "dev",
        "prod",
      ]);
    });

    it("should ignore experiments that only ran outside the window", async () => {
      // Given an exposure from before the window
      await exposure("control", "visitor-1", { at: "2026-06-01T10:00:00Z" });

      // When I build the report
      const report = await insights.build({ from, to });

      // Then no experiment is reported
      expect(report.experiments).toEqual([]);
    });

    it("should include the campaigns that produced signups", async () => {
      // Given a tagged signup
      await signup({ campaign: "alpha_launch", accountId });

      // When I build the report
      const report = await insights.build({ from, to });

      // Then the campaign appears in the report
      expect(report.campaigns.map((c) => c.campaign)).toEqual(["alpha_launch"]);
    });

    it("should warn when signups were captured without an account", async () => {
      // Given a signup event that carries no accountId
      await signup({ accountId: undefined });

      // When I build the report
      const report = await insights.build({ from, to });

      // Then the report warns that those signups are invisible to tenant queries
      expect(report.warnings.join(" ")).toMatch(/accountId/i);
    });

    it("should warn when the leads table and the warehouse disagree", async () => {
      // Given two leads captured but only one signup event recorded
      await db.collection("leads").insertMany([
        { email: "a@example.com", createdAt: new Date("2026-07-02T10:00:00Z") },
        { email: "b@example.com", createdAt: new Date("2026-07-03T10:00:00Z") },
      ]);
      await signup({ accountId });

      // When I build the report
      const report = await insights.build({ from, to });

      // Then the gap is called out
      expect(report.warnings.join(" ")).toMatch(/lead/i);
    });

    it("should stay quiet when the data reconciles", async () => {
      // Given one lead and one matching, fully attributed signup event
      await db.collection("leads").insertOne({
        email: "a@example.com",
        createdAt: new Date("2026-07-02T10:00:00Z"),
      });
      await signup({ accountId });

      // When I build the report
      const report = await insights.build({ from, to });

      // Then nothing is flagged
      expect(report.warnings).toEqual([]);
    });

    it("should warn when an event is never attributed to anyone", async () => {
      // Given a feature that fires without ever recording who did it
      await repo.insert({
        type: "track",
        event: "build_reported",
        timestamp: new Date("2026-07-02T10:00:00Z"),
        accountId,
        properties: {},
      });

      // When I build the report
      const report = await insights.build({ from, to });

      // Then the report warns that the event cannot carry funnels or usage
      expect(report.warnings.join(" ")).toContain("build_reported");
      expect(report.warnings.join(" ")).toMatch(/distinctId/i);
    });

    it("should not warn about events that do identify their actor", async () => {
      // Given a feature that always records who did it
      await repo.insert({
        type: "track",
        event: "build_reported",
        timestamp: new Date("2026-07-02T10:00:00Z"),
        distinctId: "alice",
        accountId,
        properties: {},
      });

      // When I build the report
      const report = await insights.build({ from, to });

      // Then nothing is flagged about it
      expect(report.warnings.join(" ")).not.toContain("build_reported");
    });

    it("should carry the requested window into the report", async () => {
      // Given any data
      // When I build the report
      const report = await insights.build({ from, to });

      // Then the window travels with it
      expect(report.from).toEqual(from);
      expect(report.to).toEqual(to);
    });

    it("should report product usage over the window", async () => {
      // Given someone using the product
      await repo.insert({
        type: "track",
        event: "build_reported",
        timestamp: new Date("2026-07-02T10:00:00Z"),
        distinctId: "alice",
        accountId,
        properties: {},
      });

      // When I build the report
      const report = await insights.build({ from, to });

      // Then their activity shows up
      expect(report.usage.features.map((f) => f.event)).toContain(
        "build_reported",
      );
      expect(report.usage.activeUsers[0].users).toBe(1);
    });
  });
});
