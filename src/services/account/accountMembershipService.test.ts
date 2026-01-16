import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { UserRepository } from "../../repositories/userRepository";
import { MembershipRepository } from "../../repositories/membershipRepository";
import { AccountMembershipService } from "./accountMembershipService";

describe("AccountMembershipService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let userRepo: UserRepository;
  let membershipRepo: MembershipRepository;
  let service: AccountMembershipService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    userRepo = new UserRepository(db);
    membershipRepo = new MembershipRepository(db);
    service = new AccountMembershipService(
      membershipRepo,
      accountRepo,
      userRepo,
    );
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("users").deleteMany({});
    await db.collection("accountMemberships").deleteMany({});
  });

  describe("getUserAccounts", () => {
    it("should return all accounts user belongs to with their roles", async () => {
      // Given: a user who is member of multiple accounts
      const user = await userRepo.findOrCreate({
        githubId: 100,
        githubLogin: "multiuser",
        email: "multi@example.com",
        name: "Multi User",
        avatarUrl: null,
        githubAccessToken: "token",
      });

      const account1 = await accountRepo.create({
        name: "Org 1",
        slug: "org-1",
      });
      const account2 = await accountRepo.create({
        name: "Org 2",
        slug: "org-2",
      });

      await membershipRepo.create({
        userId: user._id,
        accountId: account1._id,
        role: "owner",
      });
      await membershipRepo.create({
        userId: user._id,
        accountId: account2._id,
        role: "member",
      });

      // When: I get user's accounts
      const accounts = await service.getUserAccounts(user._id);

      // Then: I get both accounts with roles
      expect(accounts).toHaveLength(2);
      expect(accounts.map((a) => a.account.slug).sort()).toEqual([
        "org-1",
        "org-2",
      ]);

      const org1 = accounts.find((a) => a.account.slug === "org-1");
      expect(org1?.role).toBe("owner");

      const org2 = accounts.find((a) => a.account.slug === "org-2");
      expect(org2?.role).toBe("member");
    });

    it("should return empty array for user with no accounts", async () => {
      // Given: a user with no memberships
      const user = await userRepo.findOrCreate({
        githubId: 200,
        githubLogin: "lonelyuser",
        email: "lonely@example.com",
        name: "Lonely User",
        avatarUrl: null,
        githubAccessToken: "token",
      });

      // When: I get user's accounts
      const accounts = await service.getUserAccounts(user._id);

      // Then: I get empty array
      expect(accounts).toEqual([]);
    });
  });

  describe("getAccountMembers", () => {
    it("should return all members of an account with their roles", async () => {
      // Given: an account with multiple members
      const account = await accountRepo.create({
        name: "Team Org",
        slug: "team-org",
      });

      const owner = await userRepo.findOrCreate({
        githubId: 300,
        githubLogin: "owner",
        email: "owner@example.com",
        name: "Owner",
        avatarUrl: null,
        githubAccessToken: "token",
      });
      const member = await userRepo.findOrCreate({
        githubId: 301,
        githubLogin: "member",
        email: "member@example.com",
        name: "Member",
        avatarUrl: null,
        githubAccessToken: "token",
      });

      await membershipRepo.create({
        userId: owner._id,
        accountId: account._id,
        role: "owner",
      });
      await membershipRepo.create({
        userId: member._id,
        accountId: account._id,
        role: "member",
      });

      // When: I get account members
      const members = await service.getAccountMembers(account._id);

      // Then: I get both members with roles
      expect(members).toHaveLength(2);
      expect(members.find((m) => m.role === "owner")?.user.githubLogin).toBe(
        "owner",
      );
      expect(members.find((m) => m.role === "member")?.user.githubLogin).toBe(
        "member",
      );
    });
  });

  describe("getUserRole", () => {
    it("should return user's role in an account", async () => {
      // Given: a user with admin role in an account
      const user = await userRepo.findOrCreate({
        githubId: 400,
        githubLogin: "admin",
        email: "admin@example.com",
        name: "Admin",
        avatarUrl: null,
        githubAccessToken: "token",
      });
      const account = await accountRepo.create({
        name: "Admin Org",
        slug: "admin-org",
      });
      await membershipRepo.create({
        userId: user._id,
        accountId: account._id,
        role: "admin",
      });

      // When: I get user's role
      const role = await service.getUserRole(user._id, account._id);

      // Then: I get the role
      expect(role).toBe("admin");
    });

    it("should return null for non-member", async () => {
      // Given: a user not in an account
      const user = await userRepo.findOrCreate({
        githubId: 500,
        githubLogin: "outsider",
        email: "outsider@example.com",
        name: "Outsider",
        avatarUrl: null,
        githubAccessToken: "token",
      });
      const account = await accountRepo.create({
        name: "Other Org",
        slug: "other-org",
      });

      // When: I get user's role
      const role = await service.getUserRole(user._id, account._id);

      // Then: I get null
      expect(role).toBeNull();
    });
  });

  describe("canAccessAccount", () => {
    it("should return true for account member", async () => {
      // Given: a user in an account
      const user = await userRepo.findOrCreate({
        githubId: 600,
        githubLogin: "insider",
        email: "insider@example.com",
        name: "Insider",
        avatarUrl: null,
        githubAccessToken: "token",
      });
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      await membershipRepo.create({
        userId: user._id,
        accountId: account._id,
        role: "member",
      });

      // When: I check access
      const canAccess = await service.canAccessAccount(user._id, account._id);

      // Then: access is granted
      expect(canAccess).toBe(true);
    });

    it("should return false for non-member", async () => {
      // Given: a user not in an account
      const user = await userRepo.findOrCreate({
        githubId: 700,
        githubLogin: "stranger",
        email: "stranger@example.com",
        name: "Stranger",
        avatarUrl: null,
        githubAccessToken: "token",
      });
      const account = await accountRepo.create({
        name: "Private Org",
        slug: "private-org",
      });

      // When: I check access
      const canAccess = await service.canAccessAccount(user._id, account._id);

      // Then: access is denied
      expect(canAccess).toBe(false);
    });
  });
});
