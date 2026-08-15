// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

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
import { buildPageMeta } from "../../seo/meta";
import { sessionCookieOptions, oauthStateCookieOptions } from "../../cookies";
import { AnalyticsService } from "../../../services/analytics/analytics";
import { actor } from "../../../services/analytics/actorIdentity";

export type InviteRoutesDeps = {
  invitationRepository: InvitationRepository;
  membershipRepository: MembershipRepository;
  accountRepository: AccountRepository;
  sessionService: SessionService;
  cookieSecure: boolean;
  publicUrl: string;
  analytics?: AnalyticsService;
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
  cookieSecure: boolean,
): void {
  const token = sessionService.createSession({ userId, accountId });
  reply.setCookie("session", token, sessionCookieOptions(cookieSecure));
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
    cookieSecure,
    publicUrl,
    analytics,
  } = deps;

  // Invite links carry a secret token, so they must never be indexed — but they
  // should still unfurl into a friendly card when shared in Slack / iMessage.
  function inviteMeta(accountName: string, token: string) {
    return buildPageMeta({
      title: `Join ${accountName} on GitLaunch`,
      description: `You've been invited to collaborate on deployments in ${accountName} on GitLaunch.`,
      path: `/invite/${token}`,
      robots: "noindex, nofollow",
      publicUrl,
    });
  }

  function renderInvalid(reply: FastifyReply, reason: string) {
    return reply.status(410).view(
      "invite/invalid",
      {
        title: "Invitation",
        reason,
        meta: buildPageMeta({
          title: "Invitation — GitLaunch",
          path: "/invite",
          robots: "noindex, nofollow",
          publicUrl,
        }),
      },
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
            meta: inviteMeta(accountName, token),
          },
          { layout: "/layouts/main.hbs" },
        );
      }

      // Logged out: stash the token so we can finish the join right after the
      // GitHub sign-in completes, then invite them to sign in.
      reply.setCookie(
        PENDING_INVITE_COOKIE,
        token,
        oauthStateCookieOptions(cookieSecure),
      );
      return reply.view(
        "invite/accept",
        {
          title: "Join team",
          accountName,
          roleLabel,
          token,
          loggedIn: false,
          alreadyMember: false,
          meta: inviteMeta(accountName, token),
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
        reply.setCookie(
          PENDING_INVITE_COOKIE,
          token,
          oauthStateCookieOptions(cookieSecure),
        );
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

      // The closing step of the invite funnel, recorded against the workspace
      // that gained a member rather than the one they came from. Re-accepting
      // an already-redeemed link is idempotent, so it is not a second join.
      if (!result.alreadyMember) {
        analytics?.track(
          "invitation_accepted",
          {},
          actor(result.accountId, userId),
        );
      }

      // Switch the active workspace to the one they just joined.
      setSessionCookie(
        reply,
        sessionService,
        userId,
        result.accountId,
        cookieSecure,
      );
      reply.clearCookie(PENDING_INVITE_COOKIE, { path: "/" });
      return reply.redirect("/dashboard");
    },
  );
}
