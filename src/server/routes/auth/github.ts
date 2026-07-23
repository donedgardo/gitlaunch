import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomBytes } from "crypto";
import { GitHubOAuthService } from "../../../services/auth/githubOAuthService";
import { SessionService } from "../../../services/auth/sessionService";
import { UserRepository } from "../../../repositories/userRepository";
import { AccountRepository } from "../../../repositories/accountRepository";
import { MembershipRepository } from "../../../repositories/membershipRepository";
import { InvitationRepository } from "../../../repositories/invitationRepository";
import { acceptInvitation } from "../invite/acceptInvitation";
import { AnalyticsService } from "../../../services/analytics/analytics";
import { ensureAccountForUser } from "../../../services/auth/accountBootstrap";

export type GitHubAuthRoutesConfig = {
  oauthService: GitHubOAuthService;
  sessionService: SessionService;
  userRepository: UserRepository;
  accountRepository: AccountRepository;
  membershipRepository: MembershipRepository;
  // Optional: when present, a pending_invite cookie is redeemed right after
  // sign-in so a logged-out invitee joins the workspace they were invited to.
  invitationRepository?: InvitationRepository;
  analytics?: AnalyticsService;
};

export function registerGitHubAuthRoutes(
  app: FastifyInstance,
  config: GitHubAuthRoutesConfig,
): void {
  const {
    oauthService,
    sessionService,
    userRepository,
    accountRepository,
    membershipRepository,
    invitationRepository,
    analytics,
  } = config;

  // GET /auth/github - Redirect to GitHub OAuth
  app.get(
    "/auth/github",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Generate state for CSRF protection
      const state = randomBytes(16).toString("hex");

      // Store state in cookie for validation on callback
      reply.setCookie("oauth_state", state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 600, // 10 minutes
      });

      // In fake mode, skip real GitHub entirely: redirect straight to our own
      // callback with a dummy code. The fake OAuth client returns a dev user,
      // so login completes without leaving localhost. The relative path keeps
      // it on whatever host you're on, regardless of PUBLIC_URL / OAuth App
      // callback config.
      if (process.env.USE_FAKE_GITHUB === "true") {
        return reply.redirect(
          `/auth/github/callback?code=fake-dev-code&state=${state}`,
        );
      }

      const authUrl = oauthService.getAuthorizationUrl(state);
      return reply.redirect(authUrl);
    },
  );

  // GET /auth/github/callback - Handle OAuth callback
  app.get(
    "/auth/github/callback",
    async (
      request: FastifyRequest<{
        Querystring: { code?: string; state?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { code, state: _state } = request.query;

      if (!code) {
        return reply.redirect("/?error=auth_failed");
      }

      try {
        // Exchange code for token
        const tokenResponse = await oauthService.exchangeCodeForToken(code);

        // Get user info from GitHub
        const githubUser = await oauthService.getUserInfo(
          tokenResponse.access_token,
        );

        // Find or create user
        const user = await userRepository.findOrCreateByGitHubId({
          githubId: githubUser.id,
          githubLogin: githubUser.login,
          email: githubUser.email,
          name: githubUser.name,
          avatarUrl: githubUser.avatar_url,
        });

        // Ensure the user has an account + Owner membership (bootstrap on first
        // login). Shared with the Google and email/password login paths.
        // accountId is `let` because a pending invite (below) can redirect the
        // session to the invited workspace instead.
        const bootstrap = await ensureAccountForUser({
          userId: user._id,
          accountName: `${githubUser.login}'s Account`,
          slugSeed: githubUser.login,
          accountRepository,
          membershipRepository,
        });
        let accountId = bootstrap.accountId;
        const isNewUser = bootstrap.isNewUser;

        // If they arrived via a shared invite link, redeem it now and make the
        // invited workspace their active account.
        let joinedViaInvite = false;
        const pendingInviteToken = request.cookies?.pending_invite;
        if (pendingInviteToken && invitationRepository) {
          const accepted = await acceptInvitation(
            invitationRepository,
            membershipRepository,
            pendingInviteToken,
            user._id,
          );
          reply.clearCookie("pending_invite", { path: "/" });
          if (accepted.ok) {
            accountId = accepted.accountId;
            joinedViaInvite = true;
          }
        }

        // Create session
        const sessionToken = sessionService.createSession({
          userId: user._id,
          accountId,
        });

        // Set session cookie
        reply.setCookie("session", sessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 7 * 24 * 60 * 60, // 7 days
        });

        analytics?.identify(user._id.toString(), {
          login: user.githubLogin,
          email: user.email,
        });
        analytics?.track("user_logged_in", {
          userId: user._id.toString(),
          isNewUser,
        });

        // Someone who joined via an invite lands straight in the shared
        // workspace, skipping the new-account onboarding.
        if (joinedViaInvite) {
          return reply.redirect("/dashboard");
        }

        // New users pick a plan first, then create their first service. GitHub
        // is no longer the onboarding gate (Jenkins/raw shops never connect it),
        // so returning users go straight to their dashboard.
        if (isNewUser) {
          return reply.redirect("/onboarding/plan-selection");
        }

        return reply.redirect("/dashboard");
      } catch (error) {
        console.error("GitHub OAuth error:", error);
        return reply.redirect("/?error=auth_failed");
      }
    },
  );

  // GET /auth/logout - Clear session
  app.get(
    "/auth/logout",
    async (request: FastifyRequest, reply: FastifyReply) => {
      analytics?.track("user_logged_out");
      reply.clearCookie("session", { path: "/" });
      return reply.redirect("/");
    },
  );
}
