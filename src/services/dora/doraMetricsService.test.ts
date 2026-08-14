import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { BuildRepository } from "../../repositories/buildRepository";
import { DeploymentStatus } from "../service/deploymentStatus";
import { DoraMetricsService } from "./doraMetricsService";

const HOUR = 60 * 60 * 1000;

describe("DoraMetricsService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let buildRepo: BuildRepository;
  let service: DoraMetricsService;

  const accountId = new ObjectId();
  const serviceId = new ObjectId();

  const window = {
    from: new Date("2026-08-01T00:00:00Z"),
    to: new Date("2026-08-11T00:00:00Z"),
  };

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    buildRepo = new BuildRepository(db);
    service = new DoraMetricsService(buildRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("builds").deleteMany({});
  });

  /**
   * Write a build straight to the collection so a whole delivery history can
   * be set up at chosen times — the repository stamps "now", which cannot
   * express a fortnight of deploys.
   */
  const givenBuild = async (
    buildId: string,
    createdAt: string,
    logs: Array<{
      environment: string;
      status: DeploymentStatus;
      at: string;
      intent?: "promote" | "rollback";
    }>,
  ) => {
    await db.collection("builds").insertOne({
      accountId,
      serviceId,
      buildId,
      deployments: {},
      deploymentLogs: logs.map((l) => ({
        environment: l.environment,
        status: l.status,
        at: new Date(l.at),
        ...(l.intent ? { intent: l.intent } : {}),
      })),
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
    });
  };

  it("should report the four keys for a service's environment", async () => {
    // Given: v1 shipped, v2 shipped and broke, v1 was rolled back, v3 shipped
    await givenBuild("v1", "2026-08-02T11:00:00Z", [
      {
        environment: "prod",
        status: DeploymentStatus.DEPLOYED,
        at: "2026-08-02T12:00:00Z",
        intent: "promote",
      },
      {
        environment: "prod",
        status: DeploymentStatus.DEPLOYED,
        at: "2026-08-04T13:00:00Z",
        intent: "rollback",
      },
    ]);
    await givenBuild("v2", "2026-08-04T09:00:00Z", [
      {
        environment: "prod",
        status: DeploymentStatus.DEPLOYED,
        at: "2026-08-04T12:00:00Z",
        intent: "promote",
      },
    ]);
    await givenBuild("v3", "2026-08-06T10:00:00Z", [
      {
        environment: "prod",
        status: DeploymentStatus.DEPLOYED,
        at: "2026-08-06T12:00:00Z",
        intent: "promote",
      },
    ]);

    // When: we ask for the numbers
    const keys = await service.forService(accountId, serviceId, "prod", window);

    // Then: four deploys over ten days, one change in three failed, and it
    // took an hour to get back
    expect(keys.deploymentFrequencyPerDay).toBeCloseTo(0.4);
    expect(keys.medianLeadTimeMs).toBe(2 * HOUR);
    expect(keys.changeFailureRate).toBeCloseTo(1 / 3);
    expect(keys.medianTimeToRestoreMs).toBe(1 * HOUR);
    expect(keys.sample.deployments).toBe(4);
  });

  it("should measure lead time from when the build was first seen", async () => {
    // Given: a build reported an hour before it went live
    await givenBuild("v1", "2026-08-02T11:00:00Z", [
      {
        environment: "prod",
        status: DeploymentStatus.DEPLOYED,
        at: "2026-08-02T12:00:00Z",
        intent: "promote",
      },
    ]);

    // When: we ask for the numbers
    const keys = await service.forService(accountId, serviceId, "prod", window);

    // Then: one hour
    expect(keys.medianLeadTimeMs).toBe(1 * HOUR);
  });

  it("should keep one account's delivery out of another's numbers", async () => {
    // Given: a build belonging to someone else
    await db.collection("builds").insertOne({
      accountId: new ObjectId(),
      serviceId,
      buildId: "theirs",
      deployments: {},
      deploymentLogs: [
        {
          environment: "prod",
          status: DeploymentStatus.DEPLOYED,
          at: new Date("2026-08-02T12:00:00Z"),
        },
      ],
      createdAt: new Date("2026-08-02T11:00:00Z"),
      updatedAt: new Date("2026-08-02T11:00:00Z"),
    });

    // When: we ask for our numbers
    const keys = await service.forService(accountId, serviceId, "prod", window);

    // Then: we see none of it
    expect(keys.sample.deployments).toBe(0);
  });

  it("should report an empty history without inventing numbers", async () => {
    // Given: a service that has never deployed
    // When: we ask for the numbers
    const keys = await service.forService(accountId, serviceId, "prod", window);

    // Then: nothing is reported rather than zeroes that read as good scores
    expect(keys.deploymentFrequencyPerDay).toBe(0);
    expect(keys.medianLeadTimeMs).toBeNull();
    expect(keys.changeFailureRate).toBeNull();
    expect(keys.medianTimeToRestoreMs).toBeNull();
  });

  it("should ignore log entries written before intent was recorded", async () => {
    // Given: history from before the event log carried intent — an older
    // build redeployed after a newer one, which today would be a rollback
    await givenBuild("old", "2026-08-02T11:00:00Z", [
      {
        environment: "prod",
        status: DeploymentStatus.DEPLOYED,
        at: "2026-08-02T12:00:00Z",
      },
      {
        environment: "prod",
        status: DeploymentStatus.DEPLOYED,
        at: "2026-08-04T13:00:00Z",
      },
    ]);
    await givenBuild("new", "2026-08-04T09:00:00Z", [
      {
        environment: "prod",
        status: DeploymentStatus.DEPLOYED,
        at: "2026-08-04T12:00:00Z",
      },
    ]);

    // When: we ask for the numbers
    const keys = await service.forService(accountId, serviceId, "prod", window);

    // Then: no failure is claimed — an unmarked entry means "we do not know
    // it was a rollback", and guessing would put a made-up change failure
    // rate in front of a customer
    expect(keys.sample.failures).toBe(0);
    expect(keys.changeFailureRate).toBe(0);
  });

  describe("forEnvironments", () => {
    it("should report each environment's numbers separately", async () => {
      // Given: a build that reached staging quickly and prod a day later
      await givenBuild("v1", "2026-08-02T11:00:00Z", [
        {
          environment: "staging",
          status: DeploymentStatus.DEPLOYED,
          at: "2026-08-02T12:00:00Z",
          intent: "promote",
        },
        {
          environment: "prod",
          status: DeploymentStatus.DEPLOYED,
          at: "2026-08-03T11:00:00Z",
          intent: "promote",
        },
      ]);

      // When: we ask about both environments at once
      const keys = await service.forEnvironments(
        accountId,
        serviceId,
        ["staging", "prod"],
        window,
      );

      // Then: each environment answers for itself
      expect(keys.staging.medianLeadTimeMs).toBe(1 * HOUR);
      expect(keys.staging.sample.deployments).toBe(1);
      expect(keys.prod.medianLeadTimeMs).toBe(24 * HOUR);
      expect(keys.prod.sample.deployments).toBe(1);
    });

    it("should report an environment that has never deployed", async () => {
      // Given: delivery to staging only
      await givenBuild("v1", "2026-08-02T11:00:00Z", [
        {
          environment: "staging",
          status: DeploymentStatus.DEPLOYED,
          at: "2026-08-02T12:00:00Z",
          intent: "promote",
        },
      ]);

      // When: we ask about an environment nothing has reached
      const keys = await service.forEnvironments(
        accountId,
        serviceId,
        ["staging", "prod"],
        window,
      );

      // Then: it is present and empty, not missing — a column with no
      // deploys still has to render
      expect(keys.prod.sample.deployments).toBe(0);
      expect(keys.prod.medianLeadTimeMs).toBeNull();
    });

    it("should agree with asking for one environment at a time", async () => {
      // Given: a mixed history in prod
      await givenBuild("v1", "2026-08-02T11:00:00Z", [
        {
          environment: "prod",
          status: DeploymentStatus.DEPLOYED,
          at: "2026-08-02T12:00:00Z",
          intent: "promote",
        },
      ]);
      await givenBuild("v2", "2026-08-04T09:00:00Z", [
        {
          environment: "prod",
          status: DeploymentStatus.ERROR,
          at: "2026-08-04T12:00:00Z",
          intent: "promote",
        },
      ]);
      await givenBuild("v3", "2026-08-06T10:00:00Z", [
        {
          environment: "prod",
          status: DeploymentStatus.DEPLOYED,
          at: "2026-08-06T12:00:00Z",
          intent: "promote",
        },
      ]);

      // When: we ask both ways
      const batched = await service.forEnvironments(
        accountId,
        serviceId,
        ["prod"],
        window,
      );
      const single = await service.forService(
        accountId,
        serviceId,
        "prod",
        window,
      );

      // Then: the batch is a shortcut, not a different measurement
      expect(batched.prod).toEqual(single);
    });
  });
});
