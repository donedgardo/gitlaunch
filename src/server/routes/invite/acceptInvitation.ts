import { ObjectId } from "mongodb";
import { InvitationRepository } from "../../../repositories/invitationRepository";
import { MembershipRepository } from "../../../repositories/membershipRepository";

export type AcceptFailure = "not_found" | "expired" | "used";

export type AcceptResult =
  | { ok: true; accountId: ObjectId; alreadyMember: boolean }
  | { ok: false; reason: AcceptFailure };

// Redeem an invitation token for a logged-in user. Shared by the accept route
// and the GitHub OAuth callback (so a logged-out invitee joins right after
// signing in). Idempotent: re-accepting when already a member is a no-op that
// still consumes the invite, and it never creates duplicate memberships.
export async function acceptInvitation(
  invitationRepo: InvitationRepository,
  membershipRepo: MembershipRepository,
  token: string,
  userId: ObjectId,
): Promise<AcceptResult> {
  const invitation = await invitationRepo.findByToken(token);
  if (!invitation) {
    return { ok: false, reason: "not_found" };
  }
  if (invitation.status !== "pending") {
    return { ok: false, reason: "used" };
  }
  if (invitation.expiresAt < new Date()) {
    await invitationRepo.markExpired(invitation._id);
    return { ok: false, reason: "expired" };
  }

  const existing = await membershipRepo.findByUserAndAccount(
    userId,
    invitation.accountId,
  );
  if (existing) {
    await invitationRepo.markAccepted(invitation._id);
    return { ok: true, accountId: invitation.accountId, alreadyMember: true };
  }

  await membershipRepo.create({
    userId,
    accountId: invitation.accountId,
    role: invitation.role,
  });
  await invitationRepo.markAccepted(invitation._id);
  return { ok: true, accountId: invitation.accountId, alreadyMember: false };
}
