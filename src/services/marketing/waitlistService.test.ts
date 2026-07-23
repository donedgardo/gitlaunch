import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { LeadRepository } from "../../repositories/leadRepository";
import { AnalyticsService } from "../analytics/analytics";
import { WaitlistService } from "./waitlistService";

// Contract-based fake for the external analytics sink — records what was sent
// so we can assert the marketing data actually flows.
class RecordingAnalytics implements AnalyticsService {
  tracked: { event: string; properties?: Record<string, any> }[] = [];
  identified: { userId: string; traits: Record<string, any> }[] = [];
  navigations: string[] = [];

  identify(userId: string, traits: Record<string, any>): void {
    this.identified.push({ userId, traits });
  }
  track(event: string, properties?: Record<string, any>): void {
    this.tracked.push({ event, properties });
  }
  navigation(destination: string): void {
    this.navigations.push(destination);
  }
}

describe("WaitlistService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: LeadRepository;
  let analytics: RecordingAnalytics;
  let service: WaitlistService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new LeadRepository(db);
    await repo.ensureIndexes();
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("leads").deleteMany({});
    analytics = new RecordingAnalytics();
    service = new WaitlistService(repo, analytics, { minElapsedMs: 2000 });
  });

  describe("submit", () => {
    it("should subscribe a real person and stream the signup to analytics", async () => {
      // When: a genuine visitor from a tagged campaign joins
      const outcome = await service.submit({
        email: "maria@acme.dev",
        honeypot: "",
        elapsedMs: 9000,
        attribution: {
          source: "hackernews",
          medium: "community",
          campaign: "alpha-launch",
        },
      });

      // Then: they are subscribed and stored
      expect(outcome.status).toBe("subscribed");
      expect(await repo.count()).toBe(1);

      // And: a signup event carrying the campaign reaches analytics
      const signup = analytics.tracked.find(
        (t) => t.event === "waitlist_signup",
      );
      expect(signup).toBeDefined();
      expect(signup?.properties?.campaign).toBe("alpha-launch");
      expect(signup?.properties?.source).toBe("hackernews");
    });

    it("should reject a bot without storing it, and log the block for analysis", async () => {
      // When: a bot trips the honeypot
      const outcome = await service.submit({
        email: "spam@bot.net",
        honeypot: "gotcha",
        elapsedMs: 50,
        attribution: { campaign: "alpha-launch" },
      });

      // Then: nothing is stored and no signup is counted
      expect(outcome.status).toBe("rejected");
      expect(await repo.count()).toBe(0);
      expect(analytics.tracked.some((t) => t.event === "waitlist_signup")).toBe(
        false,
      );

      // And: the block is recorded so we can see bot pressure per campaign
      const blocked = analytics.tracked.find(
        (t) => t.event === "waitlist_bot_blocked",
      );
      expect(blocked).toBeDefined();
      expect(blocked?.properties?.reason).toBe("honeypot");
    });

    it("should surface the rejection reason for a malformed email", async () => {
      const outcome = await service.submit({
        email: "nope",
        honeypot: "",
        elapsedMs: 9000,
      });

      expect(outcome).toEqual({ status: "rejected", reason: "invalid_email" });
    });

    it("should not double-count a returning subscriber", async () => {
      // Given: someone already subscribed
      await service.submit({
        email: "sam@startup.io",
        elapsedMs: 9000,
        attribution: { campaign: "alpha-launch" },
      });
      analytics.tracked = [];

      // When: they submit again
      const outcome = await service.submit({
        email: "sam@startup.io",
        elapsedMs: 9000,
        attribution: { campaign: "twitter" },
      });

      // Then: they stay subscribed but no fresh signup inflates the numbers
      expect(outcome).toEqual({ status: "subscribed", alreadyOnList: true });
      expect(await repo.count()).toBe(1);
      expect(analytics.tracked.some((t) => t.event === "waitlist_signup")).toBe(
        false,
      );
    });
  });
});
