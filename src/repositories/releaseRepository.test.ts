import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { ReleaseRepository } from "./releaseRepository";
import { ReleaseArtifact } from "../services/release/release";

describe("ReleaseRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: ReleaseRepository;
  let accountId: ObjectId;
  let serviceId: ObjectId;

  const chart: ReleaseArtifact = {
    kind: "helm-chart",
    repository: "oci://ghcr.io/acme/charts",
    chart: "api",
    version: "1.4.2",
  };
  const image: ReleaseArtifact = {
    kind: "container-image",
    repository: "ghcr.io/acme/api",
    digest: "sha256:abc123",
    tag: "1.4.2",
  };

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new ReleaseRepository(db);
    await repo.ensureIndexes();
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("releases").deleteMany({});
    accountId = new ObjectId();
    serviceId = new ObjectId();
  });

  describe("create", () => {
    it("should cut a release carrying its artifacts and provenance", async () => {
      // Given a service and a set of built artifacts
      // When I cut a release
      const result = await repo.create({
        accountId,
        serviceId,
        version: "1.4.2",
        commitSha: "deadbeef",
        artifacts: [chart, image],
      });

      // Then the release is created with everything needed to deliver it
      expect(result.created).toBe(true);
      if (!result.created) return;
      expect(result.release.version).toBe("1.4.2");
      expect(result.release.commitSha).toBe("deadbeef");
      expect(result.release.artifacts).toEqual([chart, image]);
      expect(result.release.createdAt).toBeInstanceOf(Date);
    });

    it("should refuse to re-cut a version that already exists", async () => {
      // Given version 1.4.2 has been cut
      await repo.create({
        accountId,
        serviceId,
        version: "1.4.2",
        commitSha: "deadbeef",
        artifacts: [chart],
      });

      // When I cut the same version again from a different commit
      const result = await repo.create({
        accountId,
        serviceId,
        version: "1.4.2",
        commitSha: "feedface",
        artifacts: [image],
      });

      // Then it is rejected — releases are immutable once cut
      expect(result.created).toBe(false);
      if (result.created) return;
      expect(result.reason).toBe("Release 1.4.2 already exists");
    });

    it("should leave the original release untouched when a re-cut is refused", async () => {
      // Given version 1.4.2 was cut from deadbeef with a chart
      await repo.create({
        accountId,
        serviceId,
        version: "1.4.2",
        commitSha: "deadbeef",
        artifacts: [chart],
      });

      // When a re-cut is attempted with different contents
      await repo.create({
        accountId,
        serviceId,
        version: "1.4.2",
        commitSha: "feedface",
        artifacts: [image],
      });

      // Then the stored release still resolves to the original bytes
      const stored = await repo.findByVersion(accountId, serviceId, "1.4.2");
      expect(stored?.commitSha).toBe("deadbeef");
      expect(stored?.artifacts).toEqual([chart]);
    });

    it("should allow the same version on a different service", async () => {
      // Given version 1.0.0 exists on one service
      await repo.create({
        accountId,
        serviceId,
        version: "1.0.0",
        commitSha: "deadbeef",
        artifacts: [chart],
      });

      // When another service in the same account cuts 1.0.0
      const result = await repo.create({
        accountId,
        serviceId: new ObjectId(),
        version: "1.0.0",
        commitSha: "cafebabe",
        artifacts: [chart],
      });

      // Then versions are scoped per service, so it succeeds
      expect(result.created).toBe(true);
    });
  });

  describe("findByVersion", () => {
    it("should return null for a version that was never cut", async () => {
      // Given no releases
      // When I look one up
      const found = await repo.findByVersion(accountId, serviceId, "9.9.9");

      // Then nothing comes back
      expect(found).toBeNull();
    });

    it("should not return a release belonging to another account", async () => {
      // Given a release owned by one account
      await repo.create({
        accountId,
        serviceId,
        version: "1.4.2",
        commitSha: "deadbeef",
        artifacts: [chart],
      });

      // When a different account looks it up by the same service and version
      const found = await repo.findByVersion(
        new ObjectId(),
        serviceId,
        "1.4.2",
      );

      // Then tenant isolation hides it
      expect(found).toBeNull();
    });
  });

  describe("listForService", () => {
    it("should list releases newest first", async () => {
      // Given three releases cut in order
      for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
        await repo.create({
          accountId,
          serviceId,
          version,
          commitSha: `sha-${version}`,
          artifacts: [chart],
        });
      }

      // When I list them
      const releases = await repo.listForService(accountId, serviceId);

      // Then the most recent release leads
      expect(releases.map((r) => r.version)).toEqual([
        "1.2.0",
        "1.1.0",
        "1.0.0",
      ]);
    });

    it("should only list releases for the requested service", async () => {
      // Given releases on two services
      await repo.create({
        accountId,
        serviceId,
        version: "1.0.0",
        commitSha: "a",
        artifacts: [chart],
      });
      await repo.create({
        accountId,
        serviceId: new ObjectId(),
        version: "2.0.0",
        commitSha: "b",
        artifacts: [chart],
      });

      // When I list one service's releases
      const releases = await repo.listForService(accountId, serviceId);

      // Then only its own come back
      expect(releases.map((r) => r.version)).toEqual(["1.0.0"]);
    });
  });
});
