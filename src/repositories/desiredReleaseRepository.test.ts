import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { DesiredReleaseRepository } from "./desiredReleaseRepository";

describe("DesiredReleaseRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: DesiredReleaseRepository;
  let accountId: ObjectId;
  let serviceId: ObjectId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new DesiredReleaseRepository(db);
    await repo.ensureIndexes();
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("desiredReleases").deleteMany({});
    accountId = new ObjectId();
    serviceId = new ObjectId();
  });

  describe("setDesired", () => {
    it("should record the release an environment should be running", async () => {
      // Given nothing has been promoted
      // When I promote 1.4.2 to staging
      const desired = await repo.setDesired({
        accountId,
        serviceId,
        environment: "staging",
        version: "1.4.2",
      });

      // Then staging's desired state names that release
      expect(desired.environment).toBe("staging");
      expect(desired.version).toBe("1.4.2");
      expect(desired.promotedAt).toBeInstanceOf(Date);
    });

    it("should start the generation at 1 so agents have a baseline to compare", async () => {
      // Given a first promotion
      // When it lands
      const desired = await repo.setDesired({
        accountId,
        serviceId,
        environment: "staging",
        version: "1.4.2",
      });

      // Then the desired state carries the first generation
      expect(desired.generation).toBe(1);
    });

    it("should advance the generation on each promotion so a polling agent sees a change", async () => {
      // Given staging already runs 1.4.2
      await repo.setDesired({
        accountId,
        serviceId,
        environment: "staging",
        version: "1.4.2",
      });

      // When a newer release is promoted over it
      const desired = await repo.setDesired({
        accountId,
        serviceId,
        environment: "staging",
        version: "1.5.0",
      });

      // Then the generation advances and the version is replaced
      expect(desired.generation).toBe(2);
      expect(desired.version).toBe("1.5.0");
    });

    it("should keep one desired release per environment", async () => {
      // Given two promotions to the same environment
      await repo.setDesired({
        accountId,
        serviceId,
        environment: "staging",
        version: "1.4.2",
      });
      await repo.setDesired({
        accountId,
        serviceId,
        environment: "staging",
        version: "1.5.0",
      });

      // When I read the service's desired state
      const all = await repo.findForService(accountId, serviceId);

      // Then staging has exactly one entry — the latest
      expect(all).toHaveLength(1);
      expect(all[0].version).toBe("1.5.0");
    });

    it("should track environments independently", async () => {
      // Given different releases promoted to staging and prod
      await repo.setDesired({
        accountId,
        serviceId,
        environment: "staging",
        version: "1.5.0",
      });
      await repo.setDesired({
        accountId,
        serviceId,
        environment: "prod",
        version: "1.4.2",
      });

      // When I read the desired versions
      const versions = await repo.desiredVersions(accountId, serviceId);

      // Then each environment keeps its own release
      expect(versions).toEqual({ staging: "1.5.0", prod: "1.4.2" });
    });
  });

  describe("desiredVersions", () => {
    it("should return an empty map for a service with nothing promoted", async () => {
      // Given no promotions
      // When I read the desired versions
      const versions = await repo.desiredVersions(accountId, serviceId);

      // Then the map is empty — this is what feeds a first promotion
      expect(versions).toEqual({});
    });

    it("should not leak desired state across accounts", async () => {
      // Given one account promoted a release
      await repo.setDesired({
        accountId,
        serviceId,
        environment: "prod",
        version: "1.4.2",
      });

      // When another account reads the same service id
      const versions = await repo.desiredVersions(new ObjectId(), serviceId);

      // Then it sees nothing
      expect(versions).toEqual({});
    });
  });

  describe("findForEnvironment", () => {
    it("should return the desired release an agent should reconcile toward", async () => {
      // Given prod desires 1.4.2
      await repo.setDesired({
        accountId,
        serviceId,
        environment: "prod",
        version: "1.4.2",
      });

      // When the agent owning prod asks what it should run
      const desired = await repo.findForEnvironment(
        accountId,
        serviceId,
        "prod",
      );

      // Then it gets the version and the generation it can cache
      expect(desired?.version).toBe("1.4.2");
      expect(desired?.generation).toBe(1);
    });

    it("should return null for an environment that has never been promoted to", async () => {
      // Given nothing promoted
      // When an agent asks
      const desired = await repo.findForEnvironment(
        accountId,
        serviceId,
        "prod",
      );

      // Then there is nothing to reconcile
      expect(desired).toBeNull();
    });
  });
});
