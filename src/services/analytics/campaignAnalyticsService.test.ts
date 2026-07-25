import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AnalyticsEventRepository } from "../../repositories/analyticsEventRepository";
import { CampaignAnalyticsService } from "./campaignAnalyticsService";

describe("CampaignAnalyticsService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: AnalyticsEventRepository;
  let campaigns: CampaignAnalyticsService;

  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-08T00:00:00Z");

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new AnalyticsEventRepository(db);
    campaigns = new CampaignAnalyticsService(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("analytics_events").deleteMany({});
  });

  async function signup(
    attribution: Record<string, string | null>,
    options: { at?: string; distinctId?: string; accountId?: ObjectId } = {},
  ) {
    await repo.insert({
      type: "track",
      event: "waitlist_signup",
      timestamp: new Date(options.at ?? "2026-07-02T10:00:00Z"),
      distinctId: options.distinctId ?? new ObjectId().toString(),
      accountId: options.accountId,
      properties: attribution,
    });
  }

  describe("campaignPerformance", () => {
    it("should group signups by campaign, source and medium", async () => {
      // Given signups arriving from two different campaigns
      await signup({
        campaign: "alpha_launch",
        source: "dm",
        medium: "whatsapp",
      });
      await signup({
        campaign: "alpha_launch",
        source: "dm",
        medium: "whatsapp",
      });
      await signup({
        campaign: "newsletter",
        source: "email",
        medium: "newsletter",
      });

      // When I ask how the campaigns performed
      const rows = await campaigns.campaignPerformance({ from, to });

      // Then each campaign/source/medium combination is reported with its signups
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        campaign: "alpha_launch",
        source: "dm",
        medium: "whatsapp",
        signups: 2,
      });
      expect(rows[1]).toMatchObject({
        campaign: "newsletter",
        source: "email",
        medium: "newsletter",
        signups: 1,
      });
    });

    it("should report untagged signups as direct traffic", async () => {
      // Given a signup with no campaign tagging at all
      await signup({ campaign: null, source: null, medium: null });

      // When I ask how the campaigns performed
      const rows = await campaigns.campaignPerformance({ from, to });

      // Then it is attributed to direct rather than dropped
      expect(rows[0]).toMatchObject({
        campaign: "(direct)",
        source: "(direct)",
        medium: "(none)",
        signups: 1,
      });
    });

    it("should include anonymous signups that carry no account", async () => {
      // Given a signup captured before any account existed
      await signup({ campaign: "alpha_launch", source: "dm" });

      // When I ask how the campaigns performed
      const rows = await campaigns.campaignPerformance({ from, to });

      // Then the signup still counts
      expect(rows[0].signups).toBe(1);
    });

    it("should count a repeat submission from one visitor once", async () => {
      // Given the same visitor submitting the form twice
      await signup(
        { campaign: "alpha_launch", source: "dm" },
        { distinctId: "visitor-1" },
      );
      await signup(
        { campaign: "alpha_launch", source: "dm" },
        { distinctId: "visitor-1" },
      );

      // When I ask how the campaign performed
      const rows = await campaigns.campaignPerformance({ from, to });

      // Then the raw signups and the unique visitors are both reported
      expect(rows[0].signups).toBe(2);
      expect(rows[0].uniqueVisitors).toBe(1);
    });

    it("should ignore signups outside the requested window", async () => {
      // Given a signup from before the window
      await signup(
        { campaign: "old_campaign", source: "dm" },
        { at: "2026-06-01T10:00:00Z" },
      );
      // And one inside it
      await signup({ campaign: "alpha_launch", source: "dm" });

      // When I ask how the campaigns performed in the window
      const rows = await campaigns.campaignPerformance({ from, to });

      // Then only the in-window campaign is reported
      expect(rows.map((r) => r.campaign)).toEqual(["alpha_launch"]);
    });

    it("should report when each campaign first and last converted", async () => {
      // Given a campaign converting twice, days apart
      await signup(
        { campaign: "alpha_launch", source: "dm" },
        { at: "2026-07-02T10:00:00Z" },
      );
      await signup(
        { campaign: "alpha_launch", source: "dm" },
        { at: "2026-07-05T10:00:00Z" },
      );

      // When I ask how the campaign performed
      const rows = await campaigns.campaignPerformance({ from, to });

      // Then its active span is reported
      expect(rows[0].firstSignup).toEqual(new Date("2026-07-02T10:00:00Z"));
      expect(rows[0].lastSignup).toEqual(new Date("2026-07-05T10:00:00Z"));
    });

    it("should ignore events that are not signups", async () => {
      // Given some unrelated product activity in the window
      await repo.insert({
        type: "track",
        event: "user_logged_in",
        timestamp: new Date("2026-07-02T10:00:00Z"),
        properties: { campaign: "alpha_launch" },
      });

      // When I ask how the campaigns performed
      const rows = await campaigns.campaignPerformance({ from, to });

      // Then nothing is attributed
      expect(rows).toEqual([]);
    });
  });

  describe("breakdownBy", () => {
    it("should total signups for a single attribution dimension", async () => {
      // Given signups from one source across two campaigns
      await signup({ campaign: "alpha_launch", source: "dm" });
      await signup({ campaign: "beta_launch", source: "dm" });
      await signup({ campaign: "newsletter", source: "email" });

      // When I break signups down by source
      const rows = await campaigns.breakdownBy({
        from,
        to,
        dimension: "source",
      });

      // Then the sources are ranked by signups
      expect(rows).toEqual([
        { value: "dm", signups: 2 },
        { value: "email", signups: 1 },
      ]);
    });
  });
});
