import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { FlagChangeRepository } from "./flagChangeRepository";
import { Actor } from "../services/service/actor";

describe("FlagChangeRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: FlagChangeRepository;

  const maria: Actor = {
    kind: "user",
    userId: new ObjectId(),
    name: "Maria",
    via: "dashboard",
  };

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new FlagChangeRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("flagChanges").deleteMany({});
  });

  describe("record", () => {
    it("should keep who changed a flag, where, and when", async () => {
      const accountId = new ObjectId();
      const serviceId = new ObjectId();

      const change = await repo.record({
        accountId,
        serviceId,
        flagKey: "new-checkout",
        change: "configured",
        environment: "prod",
        actor: maria,
        reason: "release to everyone",
      });

      expect(change).toMatchObject({
        accountId,
        serviceId,
        flagKey: "new-checkout",
        change: "configured",
        environment: "prod",
        actor: maria,
        reason: "release to everyone",
      });
      expect(change.at).toBeInstanceOf(Date);
    });
  });

  describe("listByService", () => {
    it("should return a service's changes newest first", async () => {
      const accountId = new ObjectId();
      const serviceId = new ObjectId();
      for (const flagKey of ["first", "second", "third"]) {
        await repo.record({
          accountId,
          serviceId,
          flagKey,
          change: "created",
          actor: maria,
        });
      }

      const changes = await repo.listByService(accountId, serviceId);

      expect(changes.map((c) => c.flagKey)).toEqual([
        "third",
        "second",
        "first",
      ]);
    });

    it("should return no more than the limit asked for", async () => {
      const accountId = new ObjectId();
      const serviceId = new ObjectId();
      for (const flagKey of ["a", "b", "c"]) {
        await repo.record({
          accountId,
          serviceId,
          flagKey,
          change: "created",
          actor: maria,
        });
      }

      const changes = await repo.listByService(accountId, serviceId, 2);

      expect(changes).toHaveLength(2);
    });

    it("should never return another account's changes", async () => {
      const serviceId = new ObjectId();
      await repo.record({
        accountId: new ObjectId(),
        serviceId,
        flagKey: "theirs",
        change: "created",
        actor: maria,
      });

      const changes = await repo.listByService(new ObjectId(), serviceId);

      expect(changes).toEqual([]);
    });
  });
});
