import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import view from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { LeadRepository } from "../../../repositories/leadRepository";
import { AnalyticsService } from "../../../services/analytics/analytics";
import { WaitlistService } from "../../../services/marketing/waitlistService";
import { registerWaitlistRoutes } from "./waitlist";

class RecordingAnalytics implements AnalyticsService {
  tracked: { event: string; properties?: Record<string, any> }[] = [];
  identify(): void {}
  track(event: string, properties?: Record<string, any>): void {
    this.tracked.push({ event, properties });
  }
  navigation(): void {}
}

describe("Waitlist Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let repo: LeadRepository;
  let analytics: RecordingAnalytics;

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

    app = Fastify();
    await app.register(formbody);
    await app.register(view, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
      options: {
        partials: { waitlistResult: "/partials/waitlistResult.hbs" },
      },
    });
    registerWaitlistRoutes(app, {
      waitlistService: new WaitlistService(repo, analytics, {
        minElapsedMs: 2000,
      }),
    });
    await app.ready();
  });

  it("captures a real signup with its campaign and confirms to the visitor", async () => {
    // When: a visitor from a tagged HN link submits the form after reading it
    const response = await app.inject({
      method: "POST",
      url: "/waitlist",
      payload: {
        email: "maria@acme.dev",
        company_website: "",
        elapsedMs: "9000",
        utm_source: "hackernews",
        utm_medium: "community",
        utm_campaign: "alpha-launch",
      },
    });

    // Then: they get a confirmation
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("alpha list");

    // And: the lead is stored with attribution
    const lead = await repo.findByEmail("maria@acme.dev");
    expect(lead?.attribution.campaign).toBe("alpha-launch");
    expect(lead?.attribution.source).toBe("hackernews");

    // And: the signup flows to analytics
    expect(analytics.tracked.some((t) => t.event === "waitlist_signup")).toBe(
      true,
    );
  });

  it("silently drops a honeypot bot but shows the same success view", async () => {
    // When: a bot fills the hidden honeypot field
    const response = await app.inject({
      method: "POST",
      url: "/waitlist",
      payload: {
        email: "spam@bot.net",
        company_website: "http://spam.example",
        elapsedMs: "10",
        utm_campaign: "alpha-launch",
      },
    });

    // Then: the bot sees an ordinary success page (no tell)
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("alpha list");

    // But: nothing is stored and no signup is counted
    expect(await repo.count()).toBe(0);
    expect(analytics.tracked.some((t) => t.event === "waitlist_signup")).toBe(
      false,
    );
  });

  it("asks a human to fix a malformed email", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/waitlist",
      payload: {
        email: "not-an-email",
        company_website: "",
        elapsedMs: "9000",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("valid email");
    expect(await repo.count()).toBe(0);
  });
});
