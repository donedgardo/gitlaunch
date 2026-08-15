// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { InvitationRepository } from "./invitationRepository";
import { MembershipRole } from "./membershipRepository";

describe("InvitationRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: InvitationRepository;

  const testAccountId = new ObjectId();
  const testInviterId = new ObjectId();

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new InvitationRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("invitations").deleteMany({});
  });

  describe("create", () => {
    it("should create invitation with all required fields", async () => {
      // Given: invitation details
      const input = {
        accountId: testAccountId,
        invitedByUserId: testInviterId,
        email: "newuser@example.com",
        role: MembershipRole.Member,
        token: "abc123token",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      // When: I create the invitation
      const invitation = await repo.create(input);

      // Then: I get back the invitation with all fields
      expect(invitation._id).toBeDefined();
      expect(invitation.accountId.toString()).toBe(testAccountId.toString());
      expect(invitation.email).toBe("newuser@example.com");
      expect(invitation.role).toBe(MembershipRole.Member);
      expect(invitation.token).toBe("abc123token");
      expect(invitation.status).toBe("pending");
    });
  });

  describe("findByToken", () => {
    it("should find invitation by its token", async () => {
      // Given: an invitation exists
      await repo.create({
        accountId: testAccountId,
        invitedByUserId: testInviterId,
        email: "find@example.com",
        role: MembershipRole.Member,
        token: "findme123",
        expiresAt: new Date(Date.now() + 86400000),
      });

      // When: I find by token
      const found = await repo.findByToken("findme123");

      // Then: I get the invitation
      expect(found).not.toBeNull();
      expect(found!.email).toBe("find@example.com");
    });

    it("should return null for unknown token", async () => {
      // When: I find by unknown token
      const found = await repo.findByToken("unknown");

      // Then: I get null
      expect(found).toBeNull();
    });
  });

  describe("findPendingByEmail", () => {
    it("should find pending invitations for an email", async () => {
      // Given: multiple invitations for same email
      await repo.create({
        accountId: testAccountId,
        invitedByUserId: testInviterId,
        email: "multi@example.com",
        role: MembershipRole.Member,
        token: "token1",
        expiresAt: new Date(Date.now() + 86400000),
      });
      await repo.create({
        accountId: new ObjectId(),
        invitedByUserId: testInviterId,
        email: "multi@example.com",
        role: MembershipRole.Admin,
        token: "token2",
        expiresAt: new Date(Date.now() + 86400000),
      });

      // When: I find pending by email
      const invitations = await repo.findPendingByEmail("multi@example.com");

      // Then: I get both invitations
      expect(invitations).toHaveLength(2);
    });
  });

  describe("markAccepted", () => {
    it("should update invitation status to accepted", async () => {
      // Given: a pending invitation
      const created = await repo.create({
        accountId: testAccountId,
        invitedByUserId: testInviterId,
        email: "accept@example.com",
        role: MembershipRole.Member,
        token: "acceptme",
        expiresAt: new Date(Date.now() + 86400000),
      });

      // When: I mark it as accepted
      await repo.markAccepted(created._id);

      // Then: the status is updated
      const found = await repo.findByToken("acceptme");
      expect(found!.status).toBe("accepted");
    });
  });

  describe("findByAccountId", () => {
    it("should return all invitations for an account", async () => {
      // Given: invitations for an account
      await repo.create({
        accountId: testAccountId,
        invitedByUserId: testInviterId,
        email: "user1@example.com",
        role: MembershipRole.Member,
        token: "t1",
        expiresAt: new Date(Date.now() + 86400000),
      });
      await repo.create({
        accountId: testAccountId,
        invitedByUserId: testInviterId,
        email: "user2@example.com",
        role: MembershipRole.Admin,
        token: "t2",
        expiresAt: new Date(Date.now() + 86400000),
      });

      // When: I find by account
      const invitations = await repo.findByAccountId(testAccountId);

      // Then: I get both
      expect(invitations).toHaveLength(2);
    });
  });
});
