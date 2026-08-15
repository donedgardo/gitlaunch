import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import {
  AccountLimitReachedError,
  ensureAccountForUser,
  slugifyAccountSeed,
} from "./accountBootstrap";
import { AccountRepository } from "../../repositories/accountRepository";
import {
  MembershipRepository,
  MembershipRole,
} from "../../repositories/membershipRepository";

describe("slugifyAccountSeed", () => {
  it("should normalize seeds to url-safe slugs", () => {
    expect(slugifyAccountSeed("The Octocat")).toBe("the-octocat");
    expect(slugifyAccountSeed("a.b+c@d")).toBe("a-b-c-d");
  });

  it("should fall back to 'account' when nothing usable remains", () => {
    expect(slugifyAccountSeed("!!!")).toBe("account");
  });
});

describe("ensureAccountForUser", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepository: AccountRepository;
  let membershipRepository: MembershipRepository;

  beforeEach(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepository = new AccountRepository(db);
    membershipRepository = new MembershipRepository(db);
  });

  afterEach(async () => {
    await client.close();
    await mongoServer.stop();
  });

  it("should create an account + Owner membership for a brand-new user", async () => {
    const userId = new ObjectId();

    const result = await ensureAccountForUser({
      userId,
      accountName: "Octo's Account",
      slugSeed: "octo",
      accountRepository,
      membershipRepository,
    });

    expect(result.isNewUser).toBe(true);
    expect(result.account?.slug).toBe("octo");
    const memberships = await membershipRepository.findByUserId(userId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe(MembershipRole.Owner);
  });

  it("should reuse the existing account on a returning user", async () => {
    const userId = new ObjectId();
    const first = await ensureAccountForUser({
      userId,
      accountName: "Octo's Account",
      slugSeed: "octo",
      accountRepository,
      membershipRepository,
    });

    const second = await ensureAccountForUser({
      userId,
      accountName: "Octo's Account",
      slugSeed: "octo",
      accountRepository,
      membershipRepository,
    });

    expect(second.isNewUser).toBe(false);
    expect(second.accountId.toString()).toBe(first.accountId.toString());
    const memberships = await membershipRepository.findByUserId(userId);
    expect(memberships).toHaveLength(1);
  });

  it("should still create an account when the base slug collides", async () => {
    // Given: the natural slug is already taken by someone else
    await accountRepository.create({ name: "Taken", slug: "dev" });

    const userId = new ObjectId();
    const result = await ensureAccountForUser({
      userId,
      accountName: "Dev's Account",
      slugSeed: "dev",
      accountRepository,
      membershipRepository,
    });

    // Then: a suffixed slug is used and the user still gets an account
    expect(result.isNewUser).toBe(true);
    expect(result.account?.slug).toMatch(/^dev-/);
  });

  // Open core is single-tenant. Without a cap here, anyone who can reach the
  // login page of a self-hosted instance gets their own account, which is the
  // whole of multi-tenancy handed out for free.
  describe("on a single-tenant instance", () => {
    it("should refuse to bootstrap a second account", async () => {
      // Given an instance that already has its one account
      await ensureAccountForUser({
        userId: new ObjectId(),
        accountName: "First",
        slugSeed: "first",
        accountRepository,
        membershipRepository,
        maxAccounts: 1,
      });

      // When a different person signs in
      const second = ensureAccountForUser({
        userId: new ObjectId(),
        accountName: "Second",
        slugSeed: "second",
        accountRepository,
        membershipRepository,
        maxAccounts: 1,
      });

      // Then they are turned away rather than given their own workspace
      await expect(second).rejects.toThrow(AccountLimitReachedError);
    });

    it("should leave the existing account untouched when it refuses", async () => {
      // Given an instance at its account cap
      await ensureAccountForUser({
        userId: new ObjectId(),
        accountName: "First",
        slugSeed: "first",
        accountRepository,
        membershipRepository,
        maxAccounts: 1,
      });

      // When a second person is turned away
      await expect(
        ensureAccountForUser({
          userId: new ObjectId(),
          accountName: "Second",
          slugSeed: "second",
          accountRepository,
          membershipRepository,
          maxAccounts: 1,
        }),
      ).rejects.toThrow();

      // Then nothing was half-created
      expect(await accountRepository.countAll()).toBe(1);
    });

    it("should still let the existing member sign back in", async () => {
      // Given the one account on the instance
      const userId = new ObjectId();
      const first = await ensureAccountForUser({
        userId,
        accountName: "First",
        slugSeed: "first",
        accountRepository,
        membershipRepository,
        maxAccounts: 1,
      });

      // When they come back
      const again = await ensureAccountForUser({
        userId,
        accountName: "First",
        slugSeed: "first",
        accountRepository,
        membershipRepository,
        maxAccounts: 1,
      });

      // Then the cap never touches an existing member — it only gates creation
      expect(again.isNewUser).toBe(false);
      expect(again.accountId.toString()).toBe(first.accountId.toString());
    });

    it("should not cap anything when no limit is given", async () => {
      // Given the hosted product, which passes no cap
      await ensureAccountForUser({
        userId: new ObjectId(),
        accountName: "First",
        slugSeed: "first",
        accountRepository,
        membershipRepository,
      });

      // When a second person signs up
      const second = await ensureAccountForUser({
        userId: new ObjectId(),
        accountName: "Second",
        slugSeed: "second",
        accountRepository,
        membershipRepository,
      });

      // Then multi-tenancy works exactly as it always has
      expect(second.isNewUser).toBe(true);
      expect(await accountRepository.countAll()).toBe(2);
    });
  });
});
