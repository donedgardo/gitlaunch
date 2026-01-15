import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { MembershipRepository } from "./membershipRepository";

describe("MembershipRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: MembershipRepository;

  // Test IDs
  const userId1 = new ObjectId();
  const userId2 = new ObjectId();
  const accountId1 = new ObjectId();
  const accountId2 = new ObjectId();

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new MembershipRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accountMemberships").deleteMany({});
  });

  describe("create", () => {
    it("should create membership linking user to account with role", async () => {
      // Given: user and account IDs
      const input = {
        userId: userId1,
        accountId: accountId1,
        role: "owner" as const,
      };

      // When: I create the membership
      const membership = await repo.create(input);

      // Then: I get back a membership with the relationship
      expect(membership._id).toBeDefined();
      expect(membership.userId.toString()).toBe(userId1.toString());
      expect(membership.accountId.toString()).toBe(accountId1.toString());
      expect(membership.role).toBe("owner");
    });

    it("should support different roles: owner, admin, member", async () => {
      // When: I create memberships with different roles
      const owner = await repo.create({
        userId: new ObjectId(),
        accountId: accountId1,
        role: "owner",
      });
      const admin = await repo.create({
        userId: new ObjectId(),
        accountId: accountId1,
        role: "admin",
      });
      const member = await repo.create({
        userId: new ObjectId(),
        accountId: accountId1,
        role: "member",
      });

      // Then: each has the correct role
      expect(owner.role).toBe("owner");
      expect(admin.role).toBe("admin");
      expect(member.role).toBe("member");
    });
  });

  describe("findByUserId", () => {
    it("should return all accounts a user belongs to", async () => {
      // Given: a user belongs to two accounts
      await repo.create({
        userId: userId1,
        accountId: accountId1,
        role: "owner",
      });
      await repo.create({
        userId: userId1,
        accountId: accountId2,
        role: "member",
      });
      // And another user in one of those accounts
      await repo.create({
        userId: userId2,
        accountId: accountId1,
        role: "admin",
      });

      // When: I get memberships for user1
      const memberships = await repo.findByUserId(userId1);

      // Then: I get both accounts for that user
      expect(memberships).toHaveLength(2);
      const accountIds = memberships.map((m) => m.accountId.toString());
      expect(accountIds).toContain(accountId1.toString());
      expect(accountIds).toContain(accountId2.toString());
    });

    it("should return empty array when user has no memberships", async () => {
      // When: I get memberships for a user with no accounts
      const memberships = await repo.findByUserId(new ObjectId());

      // Then: I get an empty array
      expect(memberships).toHaveLength(0);
    });
  });

  describe("findByAccountId", () => {
    it("should return all users in an account", async () => {
      // Given: two users belong to an account
      await repo.create({
        userId: userId1,
        accountId: accountId1,
        role: "owner",
      });
      await repo.create({
        userId: userId2,
        accountId: accountId1,
        role: "member",
      });

      // When: I get memberships for the account
      const memberships = await repo.findByAccountId(accountId1);

      // Then: I get both users
      expect(memberships).toHaveLength(2);
      const userIds = memberships.map((m) => m.userId.toString());
      expect(userIds).toContain(userId1.toString());
      expect(userIds).toContain(userId2.toString());
    });
  });

  describe("findByUserAndAccount", () => {
    it("should return membership when user belongs to account", async () => {
      // Given: a membership exists
      await repo.create({
        userId: userId1,
        accountId: accountId1,
        role: "admin",
      });

      // When: I look up the specific membership
      const membership = await repo.findByUserAndAccount(userId1, accountId1);

      // Then: I find it
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe("admin");
    });

    it("should return null when user does not belong to account", async () => {
      // When: I look up a non-existent membership
      const membership = await repo.findByUserAndAccount(userId1, accountId1);

      // Then: I get null
      expect(membership).toBeNull();
    });
  });
});
