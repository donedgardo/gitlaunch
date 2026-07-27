import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { ReleaseService } from "./releaseService";
import { ReleaseArtifact } from "./release";
import { ReleaseRepository } from "../../repositories/releaseRepository";
import { DesiredReleaseRepository } from "../../repositories/desiredReleaseRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";

describe("ReleaseService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let releases: ReleaseRepository;
  let desired: DesiredReleaseRepository;
  let servicesRepo: ServiceRepository;
  let releaseService: ReleaseService;
  let accountId: ObjectId;
  let serviceId: ObjectId;

  const chart: ReleaseArtifact = {
    kind: "helm-chart",
    repository: "oci://ghcr.io/acme/charts",
    chart: "api",
    version: "1.4.2",
  };

  const cut = (version: string) =>
    releaseService.cutRelease({
      accountId,
      serviceId,
      version,
      commitSha: `sha-${version}`,
      artifacts: [{ ...chart, version }],
    });

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    releases = new ReleaseRepository(db);
    desired = new DesiredReleaseRepository(db);
    servicesRepo = new ServiceRepository(db);
    await releases.ensureIndexes();
    await desired.ensureIndexes();
    await servicesRepo.ensureIndexes();
    releaseService = new ReleaseService(releases, desired, servicesRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("releases").deleteMany({});
    await db.collection("desiredReleases").deleteMany({});
    await db.collection("services").deleteMany({});
    accountId = new ObjectId();
    const service = await servicesRepo.create({
      accountId,
      name: `api-${new ObjectId().toHexString()}`,
      repoUrl: "https://github.com/acme/api",
    });
    serviceId = service._id;
  });

  describe("cutRelease", () => {
    it("should cut a release for a service in my account", async () => {
      // Given a service I own
      // When I cut a release
      const result = await cut("1.4.2");

      // Then the release exists and can be looked up
      expect(result.created).toBe(true);
      const stored = await releases.findByVersion(
        accountId,
        serviceId,
        "1.4.2",
      );
      expect(stored?.version).toBe("1.4.2");
    });

    it("should refuse to cut a release for a service in another account", async () => {
      // Given a service belonging to someone else
      // When I try to cut a release against it
      const result = await releaseService.cutRelease({
        accountId: new ObjectId(),
        serviceId,
        version: "1.4.2",
        commitSha: "deadbeef",
        artifacts: [chart],
      });

      // Then tenant isolation refuses it
      expect(result.created).toBe(false);
      if (result.created) return;
      expect(result.reason).toBe("Service not found");
    });
  });

  describe("promote", () => {
    it("should make the release the desired state of the first environment", async () => {
      // Given a cut release
      await cut("1.4.2");

      // When I promote it to staging
      const result = await releaseService.promote({
        accountId,
        serviceId,
        version: "1.4.2",
        environment: "staging",
      });

      // Then staging's desired state is that release
      expect(result.promoted).toBe(true);
      const state = await desired.findForEnvironment(
        accountId,
        serviceId,
        "staging",
      );
      expect(state?.version).toBe("1.4.2");
    });

    it("should refuse to promote past the environment order", async () => {
      // Given a release that has not reached staging
      await cut("1.4.2");

      // When I promote it straight to prod
      const result = await releaseService.promote({
        accountId,
        serviceId,
        version: "1.4.2",
        environment: "prod",
      });

      // Then the gate blocks it
      expect(result.promoted).toBe(false);
      if (result.promoted) return;
      expect(result.reason).toBe(
        'Release 1.4.2 must reach "staging" before "prod"',
      );
    });

    it("should leave prod untouched when a promotion is blocked", async () => {
      // Given prod already runs an older release
      await cut("1.0.0");
      await cut("1.4.2");
      await releaseService.promote({
        accountId,
        serviceId,
        version: "1.0.0",
        environment: "staging",
      });
      await releaseService.promote({
        accountId,
        serviceId,
        version: "1.0.0",
        environment: "prod",
      });

      // When a release that skipped staging is promoted to prod
      await releaseService.promote({
        accountId,
        serviceId,
        version: "1.4.2",
        environment: "prod",
      });

      // Then prod still desires the release that passed the gate
      const state = await desired.findForEnvironment(
        accountId,
        serviceId,
        "prod",
      );
      expect(state?.version).toBe("1.0.0");
    });

    it("should allow prod once the release has reached staging", async () => {
      // Given a release already promoted to staging
      await cut("1.4.2");
      await releaseService.promote({
        accountId,
        serviceId,
        version: "1.4.2",
        environment: "staging",
      });

      // When I promote it onward to prod
      const result = await releaseService.promote({
        accountId,
        serviceId,
        version: "1.4.2",
        environment: "prod",
      });

      // Then it lands
      expect(result.promoted).toBe(true);
      if (!result.promoted) return;
      expect(result.desired.version).toBe("1.4.2");
    });

    it("should refuse to promote a version that was never cut", async () => {
      // Given no releases
      // When I promote a version out of thin air
      const result = await releaseService.promote({
        accountId,
        serviceId,
        version: "9.9.9",
        environment: "staging",
      });

      // Then it is refused
      expect(result.promoted).toBe(false);
      if (result.promoted) return;
      expect(result.reason).toBe("Release 9.9.9 does not exist");
    });

    it("should support rolling back to an earlier release", async () => {
      // Given staging moved from 1.0.0 to 1.4.2
      await cut("1.0.0");
      await cut("1.4.2");
      await releaseService.promote({
        accountId,
        serviceId,
        version: "1.0.0",
        environment: "staging",
      });
      await releaseService.promote({
        accountId,
        serviceId,
        version: "1.4.2",
        environment: "staging",
      });

      // When I promote the older release back
      const result = await releaseService.promote({
        accountId,
        serviceId,
        version: "1.0.0",
        environment: "staging",
      });

      // Then the rollback is a promotion like any other, and the generation
      // advances so a polling agent notices the change
      expect(result.promoted).toBe(true);
      if (!result.promoted) return;
      expect(result.desired.version).toBe("1.0.0");
      expect(result.desired.generation).toBe(3);
    });

    it("should refuse to promote a service in another account", async () => {
      // Given a release on a service I do not own
      await cut("1.4.2");

      // When another account promotes it
      const result = await releaseService.promote({
        accountId: new ObjectId(),
        serviceId,
        version: "1.4.2",
        environment: "staging",
      });

      // Then tenant isolation refuses it
      expect(result.promoted).toBe(false);
      if (result.promoted) return;
      expect(result.reason).toBe("Service not found");
    });
  });
});
