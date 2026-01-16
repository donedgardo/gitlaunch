import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import { AccountRepository } from "../../repositories/accountRepository";
import { UserRepository } from "../../repositories/userRepository";
import { MembershipRepository } from "../../repositories/membershipRepository";
import { AccountMembershipService } from "../../services/account/accountMembershipService";
import { createAccountContextMiddleware } from "./accountContext";

describe("AccountContext Middleware", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let userRepo: UserRepository;
  let membershipRepo: MembershipRepository;
  let membershipService: AccountMembershipService;
  let app: FastifyInstance;

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

    app = Fastify();
  });

  describe("account resolution", () => {
    it("should set account context from X-Account-Id header", async () => {
      // Given: a user who belongs to an account
      const user = await userRepo.findOrCreate({
        githubId: 100,
        githubLogin: "testuser",
        email: "test@example.com",
        name: "Test User",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      await membershipRepo.create({
        userId: user._id,
        accountId: account._id,
        role: "owner",
      });

      // Setup: middleware and test route
      const middleware = createAccountContextMiddleware(
        membershipService,
        accountRepo,
      );
      app.addHook("preHandler", async (request, reply) => {
        // Simulate authenticated user
        (request as any).user = { userId: user._id };
        await middleware(request, reply);
      });

      let capturedAccount: any = null;
      app.get("/test", async (request) => {
        capturedAccount = (request as any).account;
        return { ok: true };
      });

      await app.ready();

      // When: request with X-Account-Id header
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          "X-Account-Id": account._id.toString(),
        },
      });

      // Then: account context is set
      expect(response.statusCode).toBe(200);
      expect(capturedAccount).toBeDefined();
      expect(capturedAccount._id.toString()).toBe(account._id.toString());
    });

    it("should default to user's first account when no header provided", async () => {
      // Given: a user who belongs to an account
      const user = await userRepo.findOrCreate({
        githubId: 200,
        githubLogin: "defaultuser",
        email: "default@example.com",
        name: "Default User",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Default Org",
        slug: "default-org",
      });
      await membershipRepo.create({
        userId: user._id,
        accountId: account._id,
        role: "owner",
      });

      // Setup
      const middleware = createAccountContextMiddleware(
        membershipService,
        accountRepo,
      );
      app.addHook("preHandler", async (request, reply) => {
        (request as any).user = { userId: user._id };
        await middleware(request, reply);
      });

      let capturedAccount: any = null;
      app.get("/test", async (request) => {
        capturedAccount = (request as any).account;
        return { ok: true };
      });

      await app.ready();

      // When: request without account header
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      // Then: first account is used
      expect(response.statusCode).toBe(200);
      expect(capturedAccount).toBeDefined();
      expect(capturedAccount.slug).toBe("default-org");
    });

    it("should reject access to account user does not belong to", async () => {
      // Given: a user who does NOT belong to an account
      const user = await userRepo.findOrCreate({
        githubId: 300,
        githubLogin: "outsider",
        email: "outsider@example.com",
        name: "Outsider",
        avatarUrl: null,
      });

      const ownAccount = await accountRepo.create({
        name: "Own Org",
        slug: "own-org",
      });
      await membershipRepo.create({
        userId: user._id,
        accountId: ownAccount._id,
        role: "owner",
      });

      const otherAccount = await accountRepo.create({
        name: "Other Org",
        slug: "other-org",
      });
      // Note: user is NOT a member of otherAccount

      // Setup
      const middleware = createAccountContextMiddleware(
        membershipService,
        accountRepo,
      );
      app.addHook("preHandler", async (request, reply) => {
        (request as any).user = { userId: user._id };
        await middleware(request, reply);
      });

      app.get("/test", async (request) => {
        return { account: (request as any).account?.slug };
      });

      await app.ready();

      // When: request for account user doesn't belong to
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          "X-Account-Id": otherAccount._id.toString(),
        },
      });

      // Then: access denied
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.payload).error).toContain("not authorized");
    });

    it("should return 404 for non-existent account ID", async () => {
      // Given: a user
      const user = await userRepo.findOrCreate({
        githubId: 400,
        githubLogin: "someuser",
        email: "someuser@example.com",
        name: "Some User",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Real Org",
        slug: "real-org",
      });
      await membershipRepo.create({
        userId: user._id,
        accountId: account._id,
        role: "owner",
      });

      // Setup
      const middleware = createAccountContextMiddleware(
        membershipService,
        accountRepo,
      );
      app.addHook("preHandler", async (request, reply) => {
        (request as any).user = { userId: user._id };
        await middleware(request, reply);
      });

      app.get("/test", async () => ({ ok: true }));

      await app.ready();

      // When: request with non-existent account ID
      const fakeId = new ObjectId();
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          "X-Account-Id": fakeId.toString(),
        },
      });

      // Then: not found
      expect(response.statusCode).toBe(404);
    });

    it("should also set user role in account context", async () => {
      // Given: a user with admin role
      const user = await userRepo.findOrCreate({
        githubId: 500,
        githubLogin: "adminuser",
        email: "admin@example.com",
        name: "Admin User",
        avatarUrl: null,
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

      // Setup
      const middleware = createAccountContextMiddleware(
        membershipService,
        accountRepo,
      );
      app.addHook("preHandler", async (request, reply) => {
        (request as any).user = { userId: user._id };
        await middleware(request, reply);
      });

      let capturedRole: any = null;
      app.get("/test", async (request) => {
        capturedRole = (request as any).accountRole;
        return { ok: true };
      });

      await app.ready();

      // When: request
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          "X-Account-Id": account._id.toString(),
        },
      });

      // Then: role is set
      expect(response.statusCode).toBe(200);
      expect(capturedRole).toBe("admin");
    });
  });
});
