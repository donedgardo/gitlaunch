import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AnalyticsEventRepository } from "../../repositories/analyticsEventRepository";
import { ProductUsageService } from "./productUsageService";

describe("ProductUsageService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: AnalyticsEventRepository;
  let usage: ProductUsageService;

  const accountId = new ObjectId();
  const otherAccountId = new ObjectId();

  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-08T00:00:00Z");

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new AnalyticsEventRepository(db);
    usage = new ProductUsageService(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("analytics_events").deleteMany({});
  });

  async function track(
    event: string,
    at: string,
    distinctId: string,
    options: { accountId?: ObjectId; type?: "track" | "identify" } = {},
  ) {
    await repo.insert({
      type: options.type ?? "track",
      event,
      timestamp: new Date(at),
      distinctId,
      accountId: options.accountId ?? accountId,
      properties: {},
    });
  }

  describe("activeUsers", () => {
    it("should count the distinct people active on each day", async () => {
      // Given two people active on one day and one on the next
      await track("user_logged_in", "2026-07-02T09:00:00Z", "alice");
      await track("user_logged_in", "2026-07-02T11:00:00Z", "bob");
      await track("build_reported", "2026-07-03T09:00:00Z", "alice");

      // When I ask for daily active users
      const points = await usage.activeUsers({ from, to, interval: "day" });

      // Then each day reports its own headcount
      expect(points).toEqual([
        { bucket: new Date("2026-07-02T00:00:00Z"), users: 2 },
        { bucket: new Date("2026-07-03T00:00:00Z"), users: 1 },
      ]);
    });

    it("should count a busy person once per day", async () => {
      // Given one person doing several things in a day
      await track("user_logged_in", "2026-07-02T09:00:00Z", "alice");
      await track("build_reported", "2026-07-02T10:00:00Z", "alice");
      await track("flag_updated", "2026-07-02T11:00:00Z", "alice");

      // When I ask for daily active users
      const points = await usage.activeUsers({ from, to, interval: "day" });

      // Then they count once
      expect(points).toEqual([
        { bucket: new Date("2026-07-02T00:00:00Z"), users: 1 },
      ]);
    });

    it("should roll activity up into weeks when asked", async () => {
      // Given activity on two days of the same week
      await track("user_logged_in", "2026-07-02T09:00:00Z", "alice");
      await track("user_logged_in", "2026-07-03T09:00:00Z", "bob");

      // When I ask for weekly active users
      const points = await usage.activeUsers({ from, to, interval: "week" });

      // Then they collapse into a single weekly bucket
      expect(points).toHaveLength(1);
      expect(points[0].users).toBe(2);
    });

    it("should only count the account I asked about", async () => {
      // Given activity in two different accounts
      await track("user_logged_in", "2026-07-02T09:00:00Z", "alice");
      await track("user_logged_in", "2026-07-02T09:00:00Z", "intruder", {
        accountId: otherAccountId,
      });

      // When I ask for one account's daily active users
      const points = await usage.activeUsers({
        from,
        to,
        interval: "day",
        accountId,
      });

      // Then the other account's people are not counted
      expect(points).toEqual([
        { bucket: new Date("2026-07-02T00:00:00Z"), users: 1 },
      ]);
    });
  });

  describe("activeUsers by audience", () => {
    const loggedInUser = "6a5ee3c88892169df80ea18a";
    const anotherUser = "6a5ee3c88892169df80ea18b";
    const anonymousVisitor = "6953af16-c997-4c9e-ad84-0c21ce8d5cef";
    const apiKey = "apikey:6a5ee3d78892169df80ea18e";

    beforeEach(async () => {
      await track("user_logged_in", "2026-07-02T09:00:00Z", loggedInUser);
      await track("build_reported", "2026-07-02T09:30:00Z", anotherUser);
      await track("flag_exposure", "2026-07-02T10:00:00Z", anonymousVisitor);
      await track("deployment_status_updated", "2026-07-02T11:00:00Z", apiKey);
      await track(
        "waitlist_signup",
        "2026-07-02T12:00:00Z",
        "lead@example.com",
      );
    });

    it("should count only logged-in people as product active users", async () => {
      // When I ask for active users who are actually people using the product
      const points = await usage.activeUsers({
        from,
        to,
        interval: "day",
        audience: "user",
      });

      // Then anonymous visitors, API keys and leads are excluded
      expect(points).toEqual([
        { bucket: new Date("2026-07-02T00:00:00Z"), users: 2 },
      ]);
    });

    it("should count anonymous landing visitors on their own", async () => {
      // When I ask for the anonymous audience
      const points = await usage.activeUsers({
        from,
        to,
        interval: "day",
        audience: "visitor",
      });

      // Then only the gl_vid visitor is counted
      expect(points[0].users).toBe(1);
    });

    it("should count every actor when no audience is asked for", async () => {
      // When I ask without naming an audience
      const points = await usage.activeUsers({ from, to, interval: "day" });

      // Then all five actors are counted, as before
      expect(points[0].users).toBe(5);
    });

    it("should break the window's actors down by what they are", async () => {
      // When I ask who was active over the window
      const breakdown = await usage.audienceBreakdown({ from, to });

      // Then each kind of actor is counted separately, so nobody quotes the
      // total as product DAU by mistake
      expect(breakdown).toEqual({
        user: 2,
        visitor: 1,
        machine: 1,
        unknown: 1,
      });
    });
  });

  describe("featureAdoption", () => {
    it("should report how many people used each feature and how often", async () => {
      // Given a feature used repeatedly by one person and once by another
      await track("flag_updated", "2026-07-02T09:00:00Z", "alice");
      await track("flag_updated", "2026-07-02T10:00:00Z", "alice");
      await track("flag_updated", "2026-07-03T10:00:00Z", "bob");
      // And a rarer feature
      await track("flag_created", "2026-07-02T09:00:00Z", "alice");

      // When I ask what is being used
      const rows = await usage.featureAdoption({ from, to });

      // Then each feature reports its reach and its volume, most-used first
      expect(rows).toEqual([
        { event: "flag_updated", users: 2, occurrences: 3 },
        { event: "flag_created", users: 1, occurrences: 1 },
      ]);
    });

    it("should ignore identify bookkeeping events", async () => {
      // Given an identify call alongside real usage
      await track("$identify", "2026-07-02T09:00:00Z", "alice", {
        type: "identify",
      });
      await track("flag_created", "2026-07-02T09:00:00Z", "alice");

      // When I ask what is being used
      const rows = await usage.featureAdoption({ from, to });

      // Then only real product usage is reported
      expect(rows.map((r) => r.event)).toEqual(["flag_created"]);
    });
  });

  describe("funnel", () => {
    it("should report how many people reached each step", async () => {
      // Given alice completing the whole journey
      await track("user_logged_in", "2026-07-02T09:00:00Z", "alice");
      await track("build_reported", "2026-07-02T10:00:00Z", "alice");
      await track("deployment_status_updated", "2026-07-02T11:00:00Z", "alice");
      // And bob stopping after logging in
      await track("user_logged_in", "2026-07-02T09:00:00Z", "bob");

      // When I run the activation funnel
      const steps = await usage.funnel({
        from,
        to,
        steps: [
          "user_logged_in",
          "build_reported",
          "deployment_status_updated",
        ],
      });

      // Then the drop-off between steps is visible
      expect(steps).toEqual([
        {
          step: "user_logged_in",
          users: 2,
          rateFromStart: 1,
          rateFromPrevious: 1,
        },
        {
          step: "build_reported",
          users: 1,
          rateFromStart: 0.5,
          rateFromPrevious: 0.5,
        },
        {
          step: "deployment_status_updated",
          users: 1,
          rateFromStart: 0.5,
          rateFromPrevious: 1,
        },
      ]);
    });

    it("should not credit a later step to someone who skipped an earlier one", async () => {
      // Given someone who reported a build without ever logging in
      await track("build_reported", "2026-07-02T10:00:00Z", "ci-robot");
      // And someone who did log in but never built
      await track("user_logged_in", "2026-07-02T09:00:00Z", "alice");

      // When I run the funnel
      const steps = await usage.funnel({
        from,
        to,
        steps: ["user_logged_in", "build_reported"],
      });

      // Then the second step only counts people who cleared the first
      expect(steps[0].users).toBe(1);
      expect(steps[1].users).toBe(0);
    });

    it("should report an empty funnel when nobody entered it", async () => {
      // Given no matching activity at all
      // When I run the funnel
      const steps = await usage.funnel({
        from,
        to,
        steps: ["user_logged_in", "build_reported"],
      });

      // Then every step is empty rather than dividing by zero
      expect(steps).toEqual([
        {
          step: "user_logged_in",
          users: 0,
          rateFromStart: 0,
          rateFromPrevious: 0,
        },
        {
          step: "build_reported",
          users: 0,
          rateFromStart: 0,
          rateFromPrevious: 0,
        },
      ]);
    });
  });
});
