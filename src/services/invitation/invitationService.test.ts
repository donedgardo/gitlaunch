import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { UserRepository } from "../../repositories/userRepository";
import { MembershipRepository } from "../../repositories/membershipRepository";
import { InvitationRepository } from "../../repositories/invitationRepository";
import { InvitationService } from "./invitationService";

describe("InvitationService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let userRepo: UserRepository;
  let membershipRepo: MembershipRepository;
  let invitationRepo: InvitationRepository;
  let service: InvitationService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    userRepo = new UserRepository(db);
    membershipRepo = new MembershipRepository(db);
    invitationRepo = new InvitationRepository(db);
    service = new InvitationService(
      invitationRepo,
      membershipRepo,
      userRepo,
      accountRepo,
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
    await db.collection("invitations").deleteMany({});
  });

  describe("invite", () => {
    it("should create invitation with unique token", async () => {
      // Given: an account and inviter
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });
      const inviter = await userRepo.findOrCreate({
        githubId: 123,
        githubLogin: "inviter",
        email: "inviter@example.com",
        name: "Inviter",
        avatarUrl: null,
        githubAccessToken: "token",
      });

      // When: I invite someone
      const invitation = await service.invite({
        accountId: account._id,
        invitedByUserId: inviter._id,
        email: "newuser@example.com",
        role: "member",
      });

      // Then: invitation is created with a token
      expect(invitation._id).toBeDefined();
      expect(invitation.email).toBe("newuser@example.com");
      expect(invitation.token).toBeDefined();
      expect(invitation.token.length).toBeGreaterThan(20);
      expect(invitation.status).toBe("pending");
    });

    it("should set expiration to 7 days from now", async () => {
      // Given: an account
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-2",
      });
      const inviter = await userRepo.findOrCreate({
        githubId: 456,
        githubLogin: "inviter2",
        email: "inviter2@example.com",
        name: "Inviter 2",
        avatarUrl: null,
        githubAccessToken: "token",
      });

      // When: I invite someone
      const invitation = await service.invite({
        accountId: account._id,
        invitedByUserId: inviter._id,
        email: "expires@example.com",
        role: "member",
      });

      // Then: expiration is ~7 days from now
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const expectedExpiry = Date.now() + sevenDaysMs;
      expect(invitation.expiresAt.getTime()).toBeGreaterThan(
        expectedExpiry - 60000,
      );
      expect(invitation.expiresAt.getTime()).toBeLessThan(
        expectedExpiry + 60000,
      );
    });

    it("should reject if user is already a member", async () => {
      // Given: a user who is already a member
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-3",
      });
      const existingUser = await userRepo.findOrCreate({
        githubId: 789,
        githubLogin: "existing",
        email: "existing@example.com",
        name: "Existing",
        avatarUrl: null,
        githubAccessToken: "token",
      });
      await membershipRepo.create({
        userId: existingUser._id,
        accountId: account._id,
        role: "member",
      });

      // When/Then: inviting them fails
      await expect(
        service.invite({
          accountId: account._id,
          invitedByUserId: existingUser._id,
          email: "existing@example.com",
          role: "admin",
        }),
      ).rejects.toThrow("User is already a member of this account");
    });
  });

  describe("accept", () => {
    it("should add user to account when accepting valid invitation", async () => {
      // Given: a pending invitation
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-4",
      });
      const inviter = await userRepo.findOrCreate({
        githubId: 100,
        githubLogin: "inviter",
        email: "inviter@example.com",
        name: "Inviter",
        avatarUrl: null,
        githubAccessToken: "token",
      });
      const invitation = await service.invite({
        accountId: account._id,
        invitedByUserId: inviter._id,
        email: "newmember@example.com",
        role: "member",
      });

      // And: the invited user now exists
      const newUser = await userRepo.findOrCreate({
        githubId: 200,
        githubLogin: "newmember",
        email: "newmember@example.com",
        name: "New Member",
        avatarUrl: null,
        githubAccessToken: "token",
      });

      // When: they accept the invitation
      const membership = await service.accept(invitation.token, newUser._id);

      // Then: they become a member
      expect(membership.userId.toString()).toBe(newUser._id.toString());
      expect(membership.accountId.toString()).toBe(account._id.toString());
      expect(membership.role).toBe("member");

      // And: invitation is marked as accepted
      const updated = await invitationRepo.findByToken(invitation.token);
      expect(updated!.status).toBe("accepted");
    });

    it("should reject expired invitation", async () => {
      // Given: an expired invitation
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org-5",
      });
      const inviter = await userRepo.findOrCreate({
        githubId: 300,
        githubLogin: "inviter3",
        email: "inviter3@example.com",
        name: "Inviter 3",
        avatarUrl: null,
        githubAccessToken: "token",
      });

      // Create invitation directly with past expiry
      const expiredInvitation = await invitationRepo.create({
        accountId: account._id,
        invitedByUserId: inviter._id,
        email: "expired@example.com",
        role: "member",
        token: "expiredtoken123",
        expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
      });

      const user = await userRepo.findOrCreate({
        githubId: 400,
        githubLogin: "expireduser",
        email: "expired@example.com",
        name: "Expired User",
        avatarUrl: null,
        githubAccessToken: "token",
      });

      // When/Then: accepting fails
      await expect(
        service.accept(expiredInvitation.token, user._id),
      ).rejects.toThrow("Invitation has expired");
    });

    it("should reject invalid token", async () => {
      // Given: a user
      const user = await userRepo.findOrCreate({
        githubId: 500,
        githubLogin: "someuser",
        email: "someuser@example.com",
        name: "Some User",
        avatarUrl: null,
        githubAccessToken: "token",
      });

      // When/Then: accepting unknown token fails
      await expect(service.accept("unknowntoken123", user._id)).rejects.toThrow(
        "Invitation not found",
      );
    });
  });

  describe("listPendingForUser", () => {
    it("should return pending invitations for user email", async () => {
      // Given: a user with pending invitations
      const account1 = await accountRepo.create({
        name: "Org 1",
        slug: "org-1",
      });
      const account2 = await accountRepo.create({
        name: "Org 2",
        slug: "org-2",
      });
      const inviter = await userRepo.findOrCreate({
        githubId: 600,
        githubLogin: "inviter",
        email: "inviter@example.com",
        name: "Inviter",
        avatarUrl: null,
        githubAccessToken: "token",
      });

      await service.invite({
        accountId: account1._id,
        invitedByUserId: inviter._id,
        email: "pending@example.com",
        role: "member",
      });
      await service.invite({
        accountId: account2._id,
        invitedByUserId: inviter._id,
        email: "pending@example.com",
        role: "admin",
      });

      // When: I list pending invitations
      const pending = await service.listPendingForEmail("pending@example.com");

      // Then: I get both
      expect(pending).toHaveLength(2);
    });
  });
});
