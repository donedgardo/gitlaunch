import { ObjectId } from "mongodb";
import * as crypto from "crypto";
import {
  InvitationRepository,
  Invitation,
} from "../../repositories/invitationRepository";
import {
  MembershipRepository,
  MembershipRole,
  AccountMembership,
} from "../../repositories/membershipRepository";
import { UserRepository } from "../../repositories/userRepository";

export type InviteInput = {
  accountId: ObjectId;
  invitedByUserId: ObjectId;
  email: string;
  role: MembershipRole;
};

const INVITATION_EXPIRY_DAYS = 7;

export class InvitationService {
  constructor(
    private invitationRepo: InvitationRepository,
    private membershipRepo: MembershipRepository,
    private userRepo: UserRepository,
  ) {}

  async invite(input: InviteInput): Promise<Invitation> {
    // Check if user with this email already exists and is a member
    const existingUser = await this.userRepo.findByEmail(input.email);
    if (existingUser) {
      const existingMembership = await this.membershipRepo.findByUserAndAccount(
        existingUser._id,
        input.accountId,
      );
      if (existingMembership) {
        throw new Error("User is already a member of this account");
      }
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString("base64url");

    // Calculate expiry
    const expiresAt = new Date(
      Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    return this.invitationRepo.create({
      accountId: input.accountId,
      invitedByUserId: input.invitedByUserId,
      email: input.email.toLowerCase(),
      role: input.role,
      token,
      expiresAt,
    });
  }

  async accept(token: string, userId: ObjectId): Promise<AccountMembership> {
    const invitation = await this.invitationRepo.findByToken(token);

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    if (invitation.status !== "pending") {
      throw new Error("Invitation has already been used");
    }

    if (invitation.expiresAt < new Date()) {
      await this.invitationRepo.markExpired(invitation._id);
      throw new Error("Invitation has expired");
    }

    // Create membership
    const membership = await this.membershipRepo.create({
      userId,
      accountId: invitation.accountId,
      role: invitation.role,
    });

    // Mark invitation as accepted
    await this.invitationRepo.markAccepted(invitation._id);

    return membership;
  }

  async listPendingForEmail(email: string): Promise<Invitation[]> {
    return this.invitationRepo.findPendingByEmail(email.toLowerCase());
  }

  async listByAccount(accountId: ObjectId): Promise<Invitation[]> {
    return this.invitationRepo.findByAccountId(accountId);
  }
}
