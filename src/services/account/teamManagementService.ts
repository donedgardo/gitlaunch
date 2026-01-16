import { ObjectId } from "mongodb";
import * as crypto from "crypto";
import {
  MembershipRepository,
  MembershipRole,
  AccountMembership,
} from "../../repositories/membershipRepository";
import {
  InvitationRepository,
  Invitation,
} from "../../repositories/invitationRepository";

export type InviteMemberInput = {
  actorUserId: ObjectId;
  accountId: ObjectId;
  email: string;
  role: MembershipRole;
};

export type RemoveMemberInput = {
  actorUserId: ObjectId;
  accountId: ObjectId;
  membershipId: ObjectId;
};

export type UpdateMemberRoleInput = {
  actorUserId: ObjectId;
  accountId: ObjectId;
  membershipId: ObjectId;
  newRole: MembershipRole;
};

const INVITATION_EXPIRY_DAYS = 7;

export class TeamManagementService {
  constructor(
    private membershipRepo: MembershipRepository,
    private invitationRepo: InvitationRepository,
  ) {}

  async inviteMember(input: InviteMemberInput): Promise<Invitation> {
    // Check actor's role
    const actorRole = await this.getActorRole(
      input.actorUserId,
      input.accountId,
    );

    // Only owners and admins can invite
    if (actorRole !== "owner" && actorRole !== "admin") {
      throw new Error("Only owners and admins can invite members");
    }

    // Only owners can invite owners
    if (input.role === "owner" && actorRole !== "owner") {
      throw new Error("Only owners can invite other owners");
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString("base64url");

    // Calculate expiry
    const expiresAt = new Date(
      Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    return this.invitationRepo.create({
      accountId: input.accountId,
      invitedByUserId: input.actorUserId,
      email: input.email.toLowerCase(),
      role: input.role,
      token,
      expiresAt,
    });
  }

  async removeMember(input: RemoveMemberInput): Promise<void> {
    // Check actor's role
    const actorRole = await this.getActorRole(
      input.actorUserId,
      input.accountId,
    );

    // Only owners and admins can remove
    if (actorRole !== "owner" && actorRole !== "admin") {
      throw new Error("Only owners and admins can remove members");
    }

    // Get the membership to be removed
    const membership = await this.membershipRepo.findById(input.membershipId);
    if (!membership) {
      throw new Error("Membership not found");
    }

    // Check if this is the last owner
    if (membership.role === "owner") {
      const ownerCount = await this.membershipRepo.countByRoleInAccount(
        input.accountId,
        "owner",
      );
      if (ownerCount <= 1) {
        throw new Error("Cannot remove the last owner");
      }
    }

    await this.membershipRepo.delete(input.membershipId);
  }

  async updateMemberRole(
    input: UpdateMemberRoleInput,
  ): Promise<AccountMembership> {
    // Check actor's role
    const actorRole = await this.getActorRole(
      input.actorUserId,
      input.accountId,
    );

    // Only owners and admins can update roles
    if (actorRole !== "owner" && actorRole !== "admin") {
      throw new Error("Only owners and admins can update member roles");
    }

    // Only owners can promote to owner
    if (input.newRole === "owner" && actorRole !== "owner") {
      throw new Error("Only owners can promote to owner role");
    }

    const updated = await this.membershipRepo.updateRole(
      input.membershipId,
      input.newRole,
    );

    if (!updated) {
      throw new Error("Membership not found");
    }

    return updated;
  }

  private async getActorRole(
    userId: ObjectId,
    accountId: ObjectId,
  ): Promise<MembershipRole | null> {
    const membership = await this.membershipRepo.findByUserAndAccount(
      userId,
      accountId,
    );
    return membership?.role ?? null;
  }
}
