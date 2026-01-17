import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { UserRepository } from "../../repositories/userRepository";
import {
  MembershipRepository,
  MembershipRole,
} from "../../repositories/membershipRepository";
import { InvitationRepository } from "../../repositories/invitationRepository";
import { TeamManagementService } from "./teamManagementService";

describe("TeamManagementService", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let accountRepo: AccountRepository;
  let userRepo: UserRepository;
  let membershipRepo: MembershipRepository;
  let invitationRepo: InvitationRepository;
  let service: TeamManagementService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    userRepo = new UserRepository(db);
    membershipRepo = new MembershipRepository(db);
    invitationRepo = new InvitationRepository(db);
    service = new TeamManagementService(membershipRepo, invitationRepo);
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

  describe("inviteMember", () => {
    it("should allow owner to invite new members", async () => {
      // Given: an owner of an account
      const owner = await userRepo.findOrCreate({
        githubId: 100,
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
        userId: owner._id,
        accountId: account._id,
        role: MembershipRole.Owner,
      });

      // When: owner invites a new member
      const invitation = await service.inviteMember({
        actorUserId: owner._id,
        accountId: account._id,
        email: "newmember@example.com",
        role: MembershipRole.Member,
      });

      // Then: invitation is created
      expect(invitation.email).toBe("newmember@example.com");
      expect(invitation.role).toBe("member");
      expect(invitation.accountId.toString()).toBe(account._id.toString());
    });

    it("should allow admin to invite new members", async () => {
      // Given: an admin of an account
      const admin = await userRepo.findOrCreate({
        githubId: 200,
        githubLogin: "admin",
        email: "admin@example.com",
        name: "Admin",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Admin Org",
        slug: "admin-org",
      });
      await membershipRepo.create({
        userId: admin._id,
        accountId: account._id,
        role: MembershipRole.Admin,
      });

      // When: admin invites a new member
      const invitation = await service.inviteMember({
        actorUserId: admin._id,
        accountId: account._id,
        email: "teammate@example.com",
        role: MembershipRole.Member,
      });

      // Then: invitation is created
      expect(invitation).toBeDefined();
      expect(invitation.email).toBe("teammate@example.com");
    });

    it("should prevent member from inviting new members", async () => {
      // Given: a regular member of an account
      const member = await userRepo.findOrCreate({
        githubId: 300,
        githubLogin: "member",
        email: "member@example.com",
        name: "Member",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Member Org",
        slug: "member-org",
      });
      await membershipRepo.create({
        userId: member._id,
        accountId: account._id,
        role: MembershipRole.Member,
      });

      // When/Then: member tries to invite - should fail
      await expect(
        service.inviteMember({
          actorUserId: member._id,
          accountId: account._id,
          email: "other@example.com",
          role: MembershipRole.Member,
        }),
      ).rejects.toThrow("Only owners and admins can invite members");
    });

    it("should prevent admin from inviting owner-level members", async () => {
      // Given: an admin
      const admin = await userRepo.findOrCreate({
        githubId: 400,
        githubLogin: "admin2",
        email: "admin2@example.com",
        name: "Admin 2",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Admin Org 2",
        slug: "admin-org-2",
      });
      await membershipRepo.create({
        userId: admin._id,
        accountId: account._id,
        role: MembershipRole.Admin,
      });

      // When/Then: admin tries to invite as owner - should fail
      await expect(
        service.inviteMember({
          actorUserId: admin._id,
          accountId: account._id,
          email: "newowner@example.com",
          role: MembershipRole.Owner,
        }),
      ).rejects.toThrow("Only owners can invite other owners");
    });

    it("should allow owner to invite admin-level members", async () => {
      // Given: an owner
      const owner = await userRepo.findOrCreate({
        githubId: 500,
        githubLogin: "owner2",
        email: "owner2@example.com",
        name: "Owner 2",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Owner Org 2",
        slug: "owner-org-2",
      });
      await membershipRepo.create({
        userId: owner._id,
        accountId: account._id,
        role: MembershipRole.Owner,
      });

      // When: owner invites an admin
      const invitation = await service.inviteMember({
        actorUserId: owner._id,
        accountId: account._id,
        email: "newadmin@example.com",
        role: MembershipRole.Admin,
      });

      // Then: invitation is created
      expect(invitation.role).toBe(MembershipRole.Admin);
    });
  });

  describe("removeMember", () => {
    it("should allow owner to remove members", async () => {
      // Given: an owner and a member
      const owner = await userRepo.findOrCreate({
        githubId: 600,
        githubLogin: "owner",
        email: "owner@test.com",
        name: "Owner",
        avatarUrl: null,
      });

      const member = await userRepo.findOrCreate({
        githubId: 601,
        githubLogin: "member",
        email: "member@test.com",
        name: "Member",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Remove Org",
        slug: "remove-org",
      });
      await membershipRepo.create({
        userId: owner._id,
        accountId: account._id,
        role: MembershipRole.Owner,
      });
      const membership = await membershipRepo.create({
        userId: member._id,
        accountId: account._id,
        role: MembershipRole.Member,
      });

      // When: owner removes the member
      await service.removeMember({
        actorUserId: owner._id,
        accountId: account._id,
        membershipId: membership._id,
      });

      // Then: member is removed
      const remaining = await membershipRepo.findByAccountId(account._id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].userId.toString()).toBe(owner._id.toString());
    });

    it("should prevent member from removing other members", async () => {
      // Given: two members
      const member1 = await userRepo.findOrCreate({
        githubId: 700,
        githubLogin: "member1",
        email: "member1@test.com",
        name: "Member 1",
        avatarUrl: null,
      });

      const member2 = await userRepo.findOrCreate({
        githubId: 701,
        githubLogin: "member2",
        email: "member2@test.com",
        name: "Member 2",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Member Org",
        slug: "members-org",
      });
      await membershipRepo.create({
        userId: member1._id,
        accountId: account._id,
        role: MembershipRole.Member,
      });
      const membership2 = await membershipRepo.create({
        userId: member2._id,
        accountId: account._id,
        role: MembershipRole.Member,
      });

      // When/Then: member1 tries to remove member2 - should fail
      await expect(
        service.removeMember({
          actorUserId: member1._id,
          accountId: account._id,
          membershipId: membership2._id,
        }),
      ).rejects.toThrow("Only owners and admins can remove members");
    });

    it("should prevent removing the last owner", async () => {
      // Given: a single owner
      const owner = await userRepo.findOrCreate({
        githubId: 800,
        githubLogin: "lastowner",
        email: "lastowner@test.com",
        name: "Last Owner",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Single Org",
        slug: "single-org",
      });
      const membership = await membershipRepo.create({
        userId: owner._id,
        accountId: account._id,
        role: MembershipRole.Owner,
      });

      // When/Then: trying to remove the last owner - should fail
      await expect(
        service.removeMember({
          actorUserId: owner._id,
          accountId: account._id,
          membershipId: membership._id,
        }),
      ).rejects.toThrow("Cannot remove the last owner");
    });

    it("should allow admin to remove regular members", async () => {
      // Given: an admin and a member
      const admin = await userRepo.findOrCreate({
        githubId: 900,
        githubLogin: "admin",
        email: "admin@test.com",
        name: "Admin",
        avatarUrl: null,
      });

      const member = await userRepo.findOrCreate({
        githubId: 901,
        githubLogin: "member",
        email: "member@test.com",
        name: "Member",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Admin Org",
        slug: "admin-test-org",
      });
      await membershipRepo.create({
        userId: admin._id,
        accountId: account._id,
        role: MembershipRole.Admin,
      });
      const membership = await membershipRepo.create({
        userId: member._id,
        accountId: account._id,
        role: MembershipRole.Member,
      });

      // When: admin removes the member
      await service.removeMember({
        actorUserId: admin._id,
        accountId: account._id,
        membershipId: membership._id,
      });

      // Then: member is removed
      const remaining = await membershipRepo.findByAccountId(account._id);
      expect(remaining).toHaveLength(1);
    });
  });

  describe("updateMemberRole", () => {
    it("should allow owner to change member roles", async () => {
      // Given: an owner and a member
      const owner = await userRepo.findOrCreate({
        githubId: 1000,
        githubLogin: "owner",
        email: "owner@role.com",
        name: "Owner",
        avatarUrl: null,
      });

      const member = await userRepo.findOrCreate({
        githubId: 1001,
        githubLogin: "member",
        email: "member@role.com",
        name: "Member",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Role Org",
        slug: "role-org",
      });
      await membershipRepo.create({
        userId: owner._id,
        accountId: account._id,
        role: MembershipRole.Owner,
      });
      const membership = await membershipRepo.create({
        userId: member._id,
        accountId: account._id,
        role: MembershipRole.Member,
      });

      // When: owner promotes member to admin
      const updated = await service.updateMemberRole({
        actorUserId: owner._id,
        accountId: account._id,
        membershipId: membership._id,
        newRole: MembershipRole.Admin,
      });

      // Then: role is updated
      expect(updated.role).toBe(MembershipRole.Admin);
    });

    it("should prevent non-owner from promoting to owner", async () => {
      // Given: an admin and a member
      const admin = await userRepo.findOrCreate({
        githubId: 1100,
        githubLogin: "admin",
        email: "admin@role.com",
        name: "Admin",
        avatarUrl: null,
      });

      const member = await userRepo.findOrCreate({
        githubId: 1101,
        githubLogin: "member",
        email: "member@role2.com",
        name: "Member",
        avatarUrl: null,
      });

      const account = await accountRepo.create({
        name: "Promote Org",
        slug: "promote-org",
      });
      await membershipRepo.create({
        userId: admin._id,
        accountId: account._id,
        role: MembershipRole.Admin,
      });
      const membership = await membershipRepo.create({
        userId: member._id,
        accountId: account._id,
        role: MembershipRole.Member,
      });

      // When/Then: admin tries to promote to owner - should fail
      await expect(
        service.updateMemberRole({
          actorUserId: admin._id,
          accountId: account._id,
          membershipId: membership._id,
          newRole: MembershipRole.Owner,
        }),
      ).rejects.toThrow("Only owners can promote to owner role");
    });
  });
});
