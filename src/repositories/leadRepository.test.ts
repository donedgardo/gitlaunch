import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { LeadRepository } from "./leadRepository";

describe("LeadRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: LeadRepository;

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
  });

  describe("capture", () => {
    it("should store an email with its campaign attribution", async () => {
      // When: a visitor from a tagged campaign link joins the waitlist
      const { created, lead } = await repo.capture({
        email: "maria@acme.dev",
        attribution: {
          source: "hackernews",
          medium: "community",
          campaign: "alpha-launch",
        },
      });

      // Then: the lead is stored with its attribution
      expect(created).toBe(true);
      expect(lead.email).toBe("maria@acme.dev");
      expect(lead.attribution.source).toBe("hackernews");
      expect(lead.attribution.campaign).toBe("alpha-launch");
      expect(lead.createdAt).toBeInstanceOf(Date);
    });

    it("should normalize the email so casing and whitespace don't create duplicates", async () => {
      // When: the same address is submitted with different casing/spacing
      await repo.capture({ email: "Maria@Acme.dev" });
      const { created } = await repo.capture({ email: "  maria@acme.dev " });

      // Then: it is recognized as the same lead
      expect(created).toBe(false);
      expect(await repo.count()).toBe(1);
    });

    it("should not double-count a returning subscriber", async () => {
      // Given: someone already on the waitlist
      await repo.capture({
        email: "sam@startup.io",
        attribution: { campaign: "alpha-launch" },
      });

      // When: they submit again from a different campaign
      const { created } = await repo.capture({
        email: "sam@startup.io",
        attribution: { campaign: "newsletter" },
      });

      // Then: no duplicate is created, and the original acquisition source is kept
      expect(created).toBe(false);
      expect(await repo.count()).toBe(1);
      const lead = await repo.findByEmail("sam@startup.io");
      expect(lead?.attribution.campaign).toBe("alpha-launch");
    });

    it("should find a captured lead by email regardless of casing", async () => {
      await repo.capture({ email: "lee@team.dev" });
      const lead = await repo.findByEmail("LEE@team.dev");
      expect(lead?.email).toBe("lee@team.dev");
    });
  });
});
