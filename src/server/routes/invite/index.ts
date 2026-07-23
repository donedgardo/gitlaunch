import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { InvitationRepository } from "../../../repositories/invitationRepository";
import {
  MembershipRepository,
  MembershipRole,
} from "../../../repositories/membershipRepository";
import { AccountRepository } from "../../../repositories/accountRepository";
import { SessionService } from "../../../services/auth/sessionService";
import { acceptInvitation } from "./acceptInvitation";

export type InviteRoutesDeps = {
  invitationRepository: InvitationRepository;
  membershipRepository: MembershipRepository;
  accountRepository: AccountRepository;
  sessionService: SessionService;
};

const ROLE_LABELS: Record<MembershipRole, string> = {
  [MembershipRole.Owner]: "Owner",
  [MembershipRole.Admin]: "Admin",
  [MembershipRole.Member]: "Member",
};

const PENDING_INVITE_COOKIE = "pending_invite";

function setSessionCookie(
  reply: FastifyReply,
  sessionService: SessionService,
  userId: ObjectId,
  accountId: ObjectId,
): void {
  const token = sessionService.createSession({ userId, accountId });
  reply.setCookie("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function registerInviteRoutes(
  app: FastifyInstance,
  deps: InviteRoutesDeps,
): void {
  const {
    invitationRepository,
    membershipRepository,
    accountRepository,
    sessionService,
  } = deps;

  function renderInvalid(reply: FastifyReply, reason: string) {
    return reply
      .status(410)
      .view(
        "invite/invalid",
        { title: "Invitation", reason },
        { layout: "/layouts/main.hbs" },
      );
  }

  // GET /invite/:token — landing page for a shared invite link
  app.get<{ Params: { token: string } }>(
    "/invite/:token",
    async (
      request: FastifyRequest<{ Params: { token: string } }>,
      reply: FastifyReply,
    ) => {
      const { token } = request.params;
      const invitation = await invitationRepository.findByToken(token);

      if (!invitation || invitation.status !== "pending") {
        return renderInvalid(reply, "This invite link is no longer valid.");
      }
      if (invitation.expiresAt < new Date()) {
        return renderInvalid(reply, "This invite link has expired.");
      }

      const account = await accountRepository.findById(invitation.accountId);
      const accountName = account?.name ?? "the workspace";
      const roleLabel = ROLE_LABELS[invitation.role];

      if (request.session) {
        const userId = new ObjectId(request.session.userId);
        const existing = await membershipRepository.findByUserAndAccount(
          userId,
          invitation.accountId,
        );
        return reply.view(
          "invite/accept",
          {
            title: "Join team",
            accountName,
            roleLabel,
            token,
            loggedIn: true,
            alreadyMember: existing !== null,
          },
          { layout: "/layouts/main.hbs" },
        );
      }

      // Logged out: stash the token so we can finish the join right after the
      // GitHub sign-in completes, then invite them to sign in.
      reply.setCookie(PENDING_INVITE_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      });
      return reply.view(
        "invite/accept",
        {
          title: "Join team",
          accountName,
          roleLabel,
          token,
          loggedIn: false,
          alreadyMember: false,
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /invite/:token/accept — redeem the invite for the logged-in user
  app.post<{ Params: { token: string } }>(
    "/invite/:token/accept",
    async (
      request: FastifyRequest<{ Params: { token: string } }>,
      reply: FastifyReply,
    ) => {
      const { token } = request.params;

      if (!request.session) {
        reply.setCookie(PENDING_INVITE_COOKIE, token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 600,
        });
        return reply.redirect("/auth/github");
      }

      const userId = new ObjectId(request.session.userId);
      const result = await acceptInvitation(
        invitationRepository,
        membershipRepository,
        token,
        userId,
      );

      if (!result.ok) {
        const reason =
          result.reason === "expired"
            ? "This invite link has expired."
            : "This invite link is no longer valid.";
        return renderInvalid(reply, reason);
      }

      // Switch the active workspace to the one they just joined.
      setSessionCookie(reply, sessionService, userId, result.accountId);
      reply.clearCookie(PENDING_INVITE_COOKIE, { path: "/" });
      return reply.redirect("/dashboard");
    },
  );
}
