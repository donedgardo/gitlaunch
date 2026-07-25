import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { ensureAccountForUser, slugifyAccountSeed } from "./accountBootstrap";
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
});
