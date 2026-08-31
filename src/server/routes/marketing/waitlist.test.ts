import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import fastifyCookie from "@fastify/cookie";
import view from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { ObjectId } from "mongodb";
import { LeadRepository } from "../../../repositories/leadRepository";
import {
  AnalyticsContext,
  AnalyticsService,
} from "../../../services/analytics/analytics";
import { WaitlistService } from "../../../services/marketing/waitlistService";
import { WaitlistExperiment } from "../../../services/marketing/waitlistExperiment";
import { FlagServiceI } from "../../../services/flag/flagService";
import { FlagEvaluation } from "../../../services/flag/flagEvaluator";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { registerWaitlistRoutes } from "./waitlist";
import { registerRateLimit } from "../../registerRateLimit";

// A flag engine stub that buckets every visitor into one fixed variant.
function fakeFlags(evaluation: FlagEvaluation): FlagServiceI {
  return {
    async evaluate(): Promise<FlagEvaluation[]> {
      return [evaluation];
    },
  } as unknown as FlagServiceI;
}

// A service repo stub whose service is owned by `accountId` — the experiment
// derives the account from the service, so it needs this to attribute events.
function fakeServices(accountId: ObjectId): ServiceRepository {
  return {
    async findById(id: ObjectId) {
      return { _id: id, accountId };
    },
  } as unknown as ServiceRepository;
}

// Builds a waitlist app that reads the visitor cookie and runs the A/B
// experiment, so we can exercise conversion attribution end to end.
async function buildExperimentApp(
  repo: LeadRepository,
  analytics: AnalyticsService,
  experiment: WaitlistExperiment,
  ownAccountId?: ObjectId,
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(formbody);
  await app.register(fastifyCookie);
  await app.register(view, {
    engine: { handlebars },
    root: path.join(__dirname, "../../../templates"),
    options: {
      partials: { waitlistResult: "/partials/waitlistResult.hbs" },
    },
  });
  registerWaitlistRoutes(app, {
    waitlistService: new WaitlistService(
      repo,
      analytics,
      { minElapsedMs: 2000 },
      ownAccountId ? { resolve: async () => ownAccountId } : undefined,
    ),
    experiment,
  });
  await app.ready();
  return app;
}

class RecordingAnalytics implements AnalyticsService {
  tracked: {
    event: string;
    properties?: Record<string, any>;
    context?: AnalyticsContext;
  }[] = [];
  identify(): void {}
  track(
    event: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    this.tracked.push({ event, properties, context });
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
    expect(response.body).toContain("waitlist");

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
    expect(response.body).toContain("waitlist");

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

  it("attributes a new signup to the visitor's landing A/B variant", async () => {
    const experiment = new WaitlistExperiment(
      fakeFlags({
        key: "waitlist-hero-copy",
        enabled: true,
        variant: "benefit-led",
        reason: "variant",
      }),
      fakeServices(new ObjectId()),
      analytics,
      {
        serviceId: new ObjectId(),
        environment: "prod",
      },
    );
    const app2 = await buildExperimentApp(repo, analytics, experiment);

    const response = await app2.inject({
      method: "POST",
      url: "/waitlist",
      cookies: { gl_vid: "visitor-xyz" },
      payload: {
        email: "converts@acme.dev",
        company_website: "",
        elapsedMs: "9000",
      },
    });

    expect(response.statusCode).toBe(200);
    // The signup is attributed to the variant the visitor was bucketed into.
    const conversion = analytics.tracked.find(
      (t) => t.event === "flag_conversion",
    );
    expect(conversion?.properties?.variant).toBe("benefit-led");
    expect(conversion?.properties?.goal).toBe("waitlist_signup");
  });

  it("files the signup under the owning account and the same visitor as the exposure", async () => {
    const ownAccountId = new ObjectId();
    const experiment = new WaitlistExperiment(
      fakeFlags({
        key: "waitlist-hero-copy",
        enabled: true,
        variant: "benefit-led",
        reason: "variant",
      }),
      fakeServices(ownAccountId),
      analytics,
      { serviceId: new ObjectId(), environment: "prod" },
    );
    const app2 = await buildExperimentApp(
      repo,
      analytics,
      experiment,
      ownAccountId,
    );

    await app2.inject({
      method: "POST",
      url: "/waitlist",
      cookies: { gl_vid: "visitor-xyz" },
      payload: {
        email: "tenanted@acme.dev",
        company_website: "",
        elapsedMs: "9000",
        utm_campaign: "alpha-launch",
      },
    });

    // The campaign signup and the A/B conversion now agree on both tenant and
    // visitor, so the dashboard can show them side by side.
    const signup = analytics.tracked.find((t) => t.event === "waitlist_signup");
    const conversion = analytics.tracked.find(
      (t) => t.event === "flag_conversion",
    );
    expect(signup?.context?.accountId).toBe(ownAccountId.toString());
    expect(signup?.context?.distinctId).toBe("visitor-xyz");
    expect(conversion?.context?.accountId).toBe(ownAccountId.toString());
    expect(conversion?.context?.distinctId).toBe("visitor-xyz");
  });

  it("records no conversion when the visitor has no experiment cookie", async () => {
    const experiment = new WaitlistExperiment(
      fakeFlags({
        key: "waitlist-hero-copy",
        enabled: true,
        variant: "benefit-led",
        reason: "variant",
      }),
      fakeServices(new ObjectId()),
      analytics,
      {
        serviceId: new ObjectId(),
        environment: "prod",
      },
    );
    const app2 = await buildExperimentApp(repo, analytics, experiment);

    const response = await app2.inject({
      method: "POST",
      url: "/waitlist",
      payload: {
        email: "nocookie@acme.dev",
        company_website: "",
        elapsedMs: "9000",
      },
    });

    expect(response.statusCode).toBe(200);
    // Still a real signup...
    expect(analytics.tracked.some((t) => t.event === "waitlist_signup")).toBe(
      true,
    );
    // ...but no variant to attribute it to.
    expect(analytics.tracked.some((t) => t.event === "flag_conversion")).toBe(
      false,
    );
  });

  it("rejects repeated submissions from the same client past the waitlist limit", async () => {
    const limited = Fastify();
    registerRateLimit(limited, { max: 1000, timeWindowMs: 60_000 });
    await limited.register(formbody);
    await limited.register(view, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
      options: {
        partials: { waitlistResult: "/partials/waitlistResult.hbs" },
      },
    });
    limited.after(() => {
      registerWaitlistRoutes(limited, {
        waitlistService: new WaitlistService(repo, analytics, {
          minElapsedMs: 2000,
        }),
      });
    });
    await limited.ready();

    const submit = (email: string) =>
      limited.inject({
        method: "POST",
        url: "/waitlist",
        payload: { email, company_website: "", elapsedMs: "9000" },
      });

    const responses = [];
    for (let i = 0; i < 6; i++) responses.push(await submit(`u${i}@acme.dev`));

    expect(responses.slice(0, 5).every((r) => r.statusCode === 200)).toBe(true);
    expect(responses[5].statusCode).toBe(429);

    await limited.close();
  });
});
