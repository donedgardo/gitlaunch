import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { TeamManagementService } from "../../../services/account/teamManagementService";
import { AccountMembershipService } from "../../../services/account/accountMembershipService";
import { InvitationRepository } from "../../../repositories/invitationRepository";
import { MembershipRole } from "../../../repositories/membershipRepository";

export type TeamRoutesDeps = {
  publicUrl: string;
  teamManagementService: TeamManagementService;
  accountMembershipService: AccountMembershipService;
  invitationRepository: InvitationRepository;
};

const ROLE_LABELS: Record<MembershipRole, string> = {
  [MembershipRole.Owner]: "Owner",
  [MembershipRole.Admin]: "Admin",
  [MembershipRole.Member]: "Member",
};

function parseRole(value: unknown): MembershipRole | null {
  if (
    value === MembershipRole.Owner ||
    value === MembershipRole.Admin ||
    value === MembershipRole.Member
  ) {
    return value;
  }
  return null;
}

function inviteLink(publicUrl: string, token: string): string {
  const base = publicUrl.replace(/\/$/, "");
  return `${base}/invite/${token}`;
}

export function registerTeamRoutes(
  app: FastifyInstance,
  deps: TeamRoutesDeps,
): void {
  const {
    publicUrl,
    teamManagementService,
    accountMembershipService,
    invitationRepository,
  } = deps;

  async function renderPage(
    accountId: ObjectId,
    userId: ObjectId,
    reply: FastifyReply,
    banner?: { error?: string; success?: string },
  ) {
    const [members, invitations, actorRole] = await Promise.all([
      accountMembershipService.getAccountMembers(accountId),
      invitationRepository.findByAccountId(accountId),
      accountMembershipService.getUserRole(userId, accountId),
    ]);

    const canInvite =
      actorRole === MembershipRole.Owner || actorRole === MembershipRole.Admin;

    return reply.view(
      "settings/team",
      {
        title: "Team",
        canInvite,
        canInviteOwner: actorRole === MembershipRole.Owner,
        members: members.map((m) => ({
          name: m.user.githubLogin,
          email: m.user.email,
          role: ROLE_LABELS[m.role],
          isYou: m.user._id.toString() === userId.toString(),
        })),
        invites: invitations
          .filter((i) => i.status === "pending")
          .map((i) => ({
            email: i.email,
            role: ROLE_LABELS[i.role],
            link: inviteLink(publicUrl, i.token),
            expiresAt: i.expiresAt.toISOString().split("T")[0],
          })),
        error: banner?.error,
        success: banner?.success,
      },
      { layout: "/layouts/main.hbs" },
    );
  }

  // GET /settings/team — members + pending invite links
  app.get(
    "/settings/team",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }
      const accountId = new ObjectId(request.session.accountId);
      const userId = new ObjectId(request.session.userId);
      return renderPage(accountId, userId, reply);
    },
  );

  // POST /settings/team/invite — create a shareable invite link
  app.post<{ Body: { email?: string; role?: string } }>(
    "/settings/team/invite",
    async (
      request: FastifyRequest<{ Body: { email?: string; role?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }
      const accountId = new ObjectId(request.session.accountId);
      const userId = new ObjectId(request.session.userId);

      const email = (request.body?.email ?? "").trim().toLowerCase();
      const role = parseRole(request.body?.role) ?? MembershipRole.Member;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return renderPage(accountId, userId, reply, {
          error: "Enter a valid email to invite.",
        });
      }

      try {
        await teamManagementService.inviteMember({
          actorUserId: userId,
          accountId,
          email,
          role,
        });
        return renderPage(accountId, userId, reply, {
          success: `Invite link ready for ${email} — copy it below and send it over.`,
        });
      } catch (err: any) {
        return renderPage(accountId, userId, reply, {
          error: err?.message ?? "Could not create the invite.",
        });
      }
    },
  );
}
