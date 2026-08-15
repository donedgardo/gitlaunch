import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import view from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { AccountRepository } from "../../../repositories/accountRepository";
import { BuildRepository } from "../../../repositories/buildRepository";
import { SessionService } from "../../../services/auth/sessionService";
import { DoraMetricsService } from "../../../services/dora/doraMetricsService";
import { DeploymentStatus } from "../../../services/service/deploymentStatus";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerHandlebarsHelpers } from "../../registerHandlebarsHelpers";
import { registerMetricsRoutes } from "./metrics";

describe("Delivery metrics page", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let serviceRepo: ServiceRepository;
  let accountRepo: AccountRepository;
  let buildRepo: BuildRepository;
  let sessionService: SessionService;
  let doraMetricsService: DoraMetricsService;

  const TEST_SECRET = "test-secret-for-sessions";
  const COOKIE_SECRET = "test-cookie-secret";

  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    registerHandlebarsHelpers();
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.collection("services").deleteMany({});
    await db.collection("accounts").deleteMany({});
    await db.collection("builds").deleteMany({});

    serviceRepo = new ServiceRepository(db);
    accountRepo = new AccountRepository(db);
    buildRepo = new BuildRepository(db);
    sessionService = new SessionService(TEST_SECRET);
    doraMetricsService = new DoraMetricsService(buildRepo);

    app = Fastify();
    await app.register(cookie, { secret: COOKIE_SECRET });
    await app.register(view, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
      options: {
        partials: {
          navigation: "/partials/navigation.hbs",
          doraPanel: "/partials/doraPanel.hbs",
          deploymentHistory: "/partials/deploymentHistory.hbs",
        },
      },
    });
    sessionAuthMiddleware(app, sessionService);
    registerMetricsRoutes(app, {
      serviceRepository: serviceRepo,
      doraMetricsService,
    });
    await app.ready();
  });

  const metricsService = async (name: string) => {
    const account = await accountRepo.create({
      name: "Test Org",
      slug: `test-org-${Date.now()}-${Math.random()}`,
    });
    const accountId = account._id;

    const service = await serviceRepo.create({
      accountId,
      repositoryId: new ObjectId(),
      name,
      environments: [
        { name: "staging", order: 0 },
        { name: "prod", order: 1 },
      ],
    });

    const sessionToken = sessionService.createSession({
      userId: new ObjectId(),
      accountId,
    });

    return { accountId, service, sessionToken };
  };

  /**
   * A build with a hand-placed deployment history, written straight to the
   * collection. Times are relative to now so the 30-day window keeps covering
   * them as real time passes.
   */
  const givenDeploy = async (
    accountId: ObjectId,
    serviceId: ObjectId,
    buildId: string,
    opts: {
      reportedAgoMs: number;
      deployedAgoMs: number;
      environment: string;
      status?: DeploymentStatus;
      intent?: "promote" | "rollback";
    },
  ) => {
    const now = Date.now();
    await db.collection("builds").insertOne({
      accountId,
      serviceId,
      buildId,
      deployments: {},
      deploymentLogs: [
        {
          environment: opts.environment,
          status: opts.status ?? DeploymentStatus.DEPLOYED,
          at: new Date(now - opts.deployedAgoMs),
          intent: opts.intent ?? "promote",
        },
      ],
      createdAt: new Date(now - opts.reportedAgoMs),
      updatedAt: new Date(now - opts.reportedAgoMs),
    });
  };

  /**
   * A build whose deployment log is written out in full, so the history has
   * a dispatch to measure a duration from.
   */
  const givenDeployLog = async (
    accountId: ObjectId,
    serviceId: ObjectId,
    buildId: string,
    opts: {
      reportedAgoMs: number;
      environment: string;
      log: Array<{
        status: DeploymentStatus;
        agoMs: number;
        intent?: "promote" | "rollback";
      }>;
    },
  ) => {
    const now = Date.now();
    await db.collection("builds").insertOne({
      accountId,
      serviceId,
      buildId,
      deployments: {},
      deploymentLogs: opts.log.map((entry) => ({
        environment: opts.environment,
        status: entry.status,
        at: new Date(now - entry.agoMs),
        ...(entry.intent ? { intent: entry.intent } : {}),
      })),
      createdAt: new Date(now - opts.reportedAgoMs),
      updatedAt: new Date(now - opts.reportedAgoMs),
    });
  };

  it("should list what was deployed, where, and how it went", async () => {
    // Given: a build that took four minutes to reach prod
    const { accountId, service, sessionToken } =
      await metricsService("shipped-service");
    await givenDeployLog(accountId, service._id, "abc1234def5678", {
      environment: "prod",
      reportedAgoMs: 2 * DAY + 1 * HOUR,
      log: [
        {
          status: DeploymentStatus.DISPATCHING,
          agoMs: 2 * DAY + 4 * 60 * 1000,
          intent: "promote",
        },
        { status: DeploymentStatus.DEPLOYED, agoMs: 2 * DAY },
      ],
    });

    // When: opening the delivery metrics page
    const response = await app.inject({
      method: "GET",
      url: `/services/${service._id}/metrics`,
      cookies: { session: sessionToken },
    });

    // Then: the deployment itself is on the page, not only the averages
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Deployment history");
    expect(response.body).toContain("abc1234");
    expect(response.body).toContain("Deployed");
    expect(response.body).toContain("4m");
  });

  it("should keep a failed deployment on the record", async () => {
    // Given: a deploy that broke, then a fix that landed
    const { accountId, service, sessionToken } =
      await metricsService("recovered-service");
    await givenDeploy(accountId, service._id, "bad0001", {
      environment: "prod",
      reportedAgoMs: 3 * DAY + 1 * HOUR,
      deployedAgoMs: 3 * DAY,
      status: DeploymentStatus.ERROR,
    });
    await givenDeploy(accountId, service._id, "fix0002", {
      environment: "prod",
      reportedAgoMs: 2 * DAY + 1 * HOUR,
      deployedAgoMs: 2 * DAY,
    });

    // When: opening the delivery metrics page
    const response = await app.inject({
      method: "GET",
      url: `/services/${service._id}/metrics`,
      cookies: { session: sessionToken },
    });

    // Then: both are listed — a change failure rate that cannot be traced to
    // a deployment is a number nobody can act on
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("bad0001");
    expect(response.body).toContain("fix0002");
    expect(response.body).toContain("Failed");
  });

  it("should point out a rollback in the history", async () => {
    // Given: a build that was put back after a bad release
    const { accountId, service, sessionToken } = await metricsService(
      "rolled-back-service",
    );
    await givenDeploy(accountId, service._id, "olde001", {
      environment: "prod",
      reportedAgoMs: 6 * DAY,
      deployedAgoMs: 1 * DAY,
      intent: "rollback",
    });

    // When: opening the delivery metrics page
    const response = await app.inject({
      method: "GET",
      url: `/services/${service._id}/metrics`,
      cookies: { session: sessionToken },
    });

    // Then: it is called what it is — the most interesting line in any
    // deployment history
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Rollback");
  });

  it("should say the history is empty rather than show an empty table", async () => {
    // Given: a service nobody has deployed
    const { service, sessionToken } = await metricsService("never-deployed");

    // When: opening the delivery metrics page
    const response = await app.inject({
      method: "GET",
      url: `/services/${service._id}/metrics`,
      cookies: { session: sessionToken },
    });

    // Then: the section answers the question instead of showing headings
    // over nothing
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Nothing has been deployed yet");
  });

  it("should show each environment's four keys", async () => {
    // Given: a service that shipped to prod an hour after the build landed
    const { accountId, service, sessionToken } =
      await metricsService("measured-service");
    await givenDeploy(accountId, service._id, "abc123", {
      environment: "prod",
      reportedAgoMs: 2 * DAY + 1 * HOUR,
      deployedAgoMs: 2 * DAY,
    });

    // When: opening the delivery metrics page
    const response = await app.inject({
      method: "GET",
      url: `/services/${service._id}/metrics`,
      cookies: { session: sessionToken },
    });

    // Then: the four keys are there
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Lead time");
    expect(response.body).toContain("Change failure rate");
    expect(response.body).toContain("Time to restore");
    expect(response.body).toContain("Deploy frequency");
    expect(response.body).toContain("1h");
  });

  it("should say an environment has no history rather than score it zero", async () => {
    // Given: delivery to staging only
    const { accountId, service, sessionToken } = await metricsService(
      "half-measured-service",
    );
    await givenDeploy(accountId, service._id, "abc123", {
      environment: "staging",
      reportedAgoMs: 2 * DAY + 1 * HOUR,
      deployedAgoMs: 2 * DAY,
    });

    // When: opening the delivery metrics page
    const response = await app.inject({
      method: "GET",
      url: `/services/${service._id}/metrics`,
      cookies: { session: sessionToken },
    });

    // Then: prod says so, instead of showing a 0% failure rate that reads
    // as a perfect score
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("No deployments yet");
  });

  it("should own up to a sample too small to be a trend", async () => {
    // Given: three deploys, one of which failed — a "33% change failure
    // rate" that is really one bad afternoon
    const { accountId, service, sessionToken } = await metricsService(
      "thin-sample-service",
    );
    await givenDeploy(accountId, service._id, "v1", {
      environment: "prod",
      reportedAgoMs: 5 * DAY + 1 * HOUR,
      deployedAgoMs: 5 * DAY,
    });
    await givenDeploy(accountId, service._id, "v2", {
      environment: "prod",
      reportedAgoMs: 3 * DAY + 1 * HOUR,
      deployedAgoMs: 3 * DAY,
      status: DeploymentStatus.ERROR,
    });
    await givenDeploy(accountId, service._id, "v3", {
      environment: "prod",
      reportedAgoMs: 1 * DAY + 1 * HOUR,
      deployedAgoMs: 1 * DAY,
    });

    // When: opening the delivery metrics page
    const response = await app.inject({
      method: "GET",
      url: `/services/${service._id}/metrics`,
      cookies: { session: sessionToken },
    });

    // Then: the number is shown with how little is behind it
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("n=2");
  });

  it("should show a service with no deployments at all rather than an empty page", async () => {
    // Given: a service nobody has deployed yet
    const { service, sessionToken } = await metricsService("brand-new-service");

    // When: opening the delivery metrics page on purpose
    const response = await app.inject({
      method: "GET",
      url: `/services/${service._id}/metrics`,
      cookies: { session: sessionToken },
    });

    // Then: "nothing yet" is the answer, per environment — the page the
    // customer navigated to never comes back blank
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("staging");
    expect(response.body).toContain("prod");
    expect(response.body).toContain("No deployments yet");
  });

  it("should say so when the metrics cannot be read", async () => {
    // Given: the metrics lookup is broken
    const { service, sessionToken } = await metricsService(
      "unreadable-metrics-service",
    );
    vi.spyOn(doraMetricsService, "forEnvironments").mockRejectedValue(
      new Error("metrics unavailable"),
    );

    // When: opening the delivery metrics page
    const response = await app.inject({
      method: "GET",
      url: `/services/${service._id}/metrics`,
      cookies: { session: sessionToken },
    });

    // Then: the page renders and admits it, rather than erroring out
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Delivery metrics are unavailable");
  });

  it("should not serve another account's service", async () => {
    // Given: a service owned by someone else
    const { service } = await metricsService("someone-elses-service");
    const intruder = await accountRepo.create({
      name: "Intruder",
      slug: `intruder-${Date.now()}`,
    });
    const intruderToken = sessionService.createSession({
      userId: new ObjectId(),
      accountId: intruder._id,
    });

    // When: they ask for its metrics
    const response = await app.inject({
      method: "GET",
      url: `/services/${service._id}/metrics`,
      cookies: { session: intruderToken },
    });

    // Then: it is not theirs to see
    expect(response.statusCode).toBe(404);
  });
});
