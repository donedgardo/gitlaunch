import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { UserRepository } from "../../repositories/userRepository";
import {
  MembershipRepository,
  MembershipRole,
} from "../../repositories/membershipRepository";
import { AccountMembershipService } from "./accountMembershipService";

describe("Tenant Security", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let userRepo: UserRepository;
  let membershipRepo: MembershipRepository;
  let membershipService: AccountMembershipService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    userRepo = new UserRepository(db);
    membershipRepo = new MembershipRepository(db);
    membershipService = new AccountMembershipService(
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

  describe("account access verification", () => {
    it("should return false when user tries to access account they don't belong to", async () => {
      // Given: two separate accounts with different users
      const user1 = await userRepo.findOrCreate({
        githubId: 100,
        githubLogin: "user1",
        email: "user1@example.com",
        name: "User 1",
        avatarUrl: null,
      });

      const user2 = await userRepo.findOrCreate({
        githubId: 200,
        githubLogin: "user2",
        email: "user2@example.com",
        name: "User 2",
        avatarUrl: null,
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
        userId: user1._id,
        accountId: account1._id,
        role: MembershipRole.Owner,
      });

      await membershipRepo.create({
        userId: user2._id,
        accountId: account2._id,
        role: MembershipRole.Owner,
      });

      // When: user1 tries to access account2
      const canAccess = await membershipService.canAccessAccount(
        user1._id,
        account2._id,
      );

      // Then: access is denied
      expect(canAccess).toBe(false);
    });

    it("should return true when user accesses their own account", async () => {
      // Given: a user with an account
      const user = await userRepo.findOrCreate({
        githubId: 300,
        githubLogin: "owner",
        email: "owner@example.com",
        name: "Owner",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      await membershipRepo.create({
        userId: user._id,
        accountId: account._id,
        role: MembershipRole.Owner,
      });

      // When: user accesses their own account
      const canAccess = await membershipService.canAccessAccount(
        user._id,
        account._id,
      );

      // Then: access is granted
      expect(canAccess).toBe(true);
    });

    it("should return null role for user not in account", async () => {
      // Given: a user and an account they're not part of
      const user = await userRepo.findOrCreate({
        githubId: 400,
        githubLogin: "stranger",
        email: "stranger@example.com",
        name: "Stranger",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Private Org",
        slug: "private-org",
      });

      // When: checking role for non-member
      const role = await membershipService.getUserRole(user._id, account._id);

      // Then: role is null
      expect(role).toBeNull();
    });

    it("should not return other accounts when listing user accounts", async () => {
      // Given: user1 belongs to account1, user2 belongs to account2
      const user1 = await userRepo.findOrCreate({
        githubId: 500,
        githubLogin: "user1",
        email: "user1@test.com",
        name: "User 1",
        avatarUrl: null,
      });

      const user2 = await userRepo.findOrCreate({
        githubId: 600,
        githubLogin: "user2",
        email: "user2@test.com",
        name: "User 2",
        avatarUrl: null,
      });

      const account1 = await accountRepo.create({
        name: "Account 1",
        slug: "account-1",
      });
      const account2 = await accountRepo.create({
        name: "Account 2",
        slug: "account-2",
      });

      await membershipRepo.create({
        userId: user1._id,
        accountId: account1._id,
        role: MembershipRole.Owner,
      });

      await membershipRepo.create({
        userId: user2._id,
        accountId: account2._id,
        role: MembershipRole.Owner,
      });

      // When: user1 lists their accounts
      const user1Accounts = await membershipService.getUserAccounts(user1._id);

      // Then: only account1 is returned (not account2)
      expect(user1Accounts).toHaveLength(1);
      expect(user1Accounts[0].account.slug).toBe("account-1");
      expect(user1Accounts.some((a) => a.account.slug === "account-2")).toBe(
        false,
      );
    });
  });

  describe("role verification", () => {
    it("should correctly identify owner role", async () => {
      const user = await userRepo.findOrCreate({
        githubId: 700,
        githubLogin: "owner",
        email: "owner@test.com",
        name: "Owner",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Owner Org",
        slug: "owner-org",
      });
      await membershipRepo.create({
        userId: user._id,
        accountId: account._id,
        role: MembershipRole.Owner,
      });

      const role = await membershipService.getUserRole(user._id, account._id);
      expect(role).toBe("owner");
    });

    it("should correctly identify admin role", async () => {
      const user = await userRepo.findOrCreate({
        githubId: 800,
        githubLogin: "admin",
        email: "admin@test.com",
        name: "Admin",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Admin Org",
        slug: "admin-org",
      });
      await membershipRepo.create({
        userId: user._id,
        accountId: account._id,
        role: MembershipRole.Admin,
      });

      const role = await membershipService.getUserRole(user._id, account._id);
      expect(role).toBe("admin");
    });

    it("should correctly identify member role", async () => {
      const user = await userRepo.findOrCreate({
        githubId: 900,
        githubLogin: "member",
        email: "member@test.com",
        name: "Member",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Member Org",
        slug: "member-org",
      });
      await membershipRepo.create({
        userId: user._id,
        accountId: account._id,
        role: MembershipRole.Member,
      });

      const role = await membershipService.getUserRole(user._id, account._id);
      expect(role).toBe("member");
    });
  });
});
