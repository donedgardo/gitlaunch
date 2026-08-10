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
import {
  SignupGate,
  signupEntityKey,
} from "../../../services/account/signupGate";
import { ensureAccountForUser } from "../../../services/auth/accountBootstrap";
import { sessionCookieOptions, oauthStateCookieOptions } from "../../cookies";
import { posthog } from "../../../instrument";

export type GitHubAuthRoutesConfig = {
  oauthService: GitHubOAuthService;
  sessionService: SessionService;
  userRepository: UserRepository;
  accountRepository: AccountRepository;
  membershipRepository: MembershipRepository;
  cookieSecure: boolean;
  useFakeGitHub: boolean;
  // Optional: when present, a pending_invite cookie is redeemed right after
  // sign-in so a logged-out invitee joins the workspace they were invited to.
  invitationRepository?: InvitationRepository;
  // Optional: when present, creating a *new* account is gated by GitLaunch's
  // own feature flag (dogfooding). Absent => signups always open.
  signupGate?: SignupGate;
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
    cookieSecure,
    useFakeGitHub,
    invitationRepository,
    signupGate,
    analytics,
  } = config;

  // GET /auth/github - Redirect to GitHub OAuth
  app.get(
    "/auth/github",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Generate state for CSRF protection
      const state = randomBytes(16).toString("hex");

      // Store state in cookie for validation on callback
      reply.setCookie(
        "oauth_state",
        state,
        oauthStateCookieOptions(cookieSecure),
      );

      // In fake mode, skip real GitHub entirely: redirect straight to our own
      // callback with a dummy code. The fake OAuth client returns a dev user,
      // so login completes without leaving localhost. The relative path keeps
      // it on whatever host you're on, regardless of PUBLIC_URL / OAuth App
      // callback config.
      if (useFakeGitHub) {
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

        // Who is signing in, and do they already belong somewhere? Answer this
        // *before* touching the database so a refused signup leaves no trace.
        const existingUser = await userRepository.findByGitHubId(githubUser.id);
        const memberships = existingUser
          ? await membershipRepository.findByUserId(existingUser._id)
          : [];

        // An invitee is vouched for by an existing customer, so they join their
        // workspace even while the public front door is shut.
        const hasPendingInvite = !!(
          request.cookies?.pending_invite && invitationRepository
        );

        // Dogfooding our own feature flags: a visitor with no membership is a
        // brand-new account, which is exactly what the flag gates. The gate
        // fails open, so this only ever refuses when someone deliberately
        // turned self-serve signups off.
        if (memberships.length === 0 && !hasPendingInvite && signupGate) {
          const entityKey = signupEntityKey(githubUser.id);
          const decision = await signupGate.allows(entityKey, {
            githubLogin: githubUser.login,
            githubId: githubUser.id,
          });
          void signupGate.recordExposure(entityKey, decision);
          if (!decision.allowed) {
            analytics?.track("signup_blocked", {
              githubLogin: githubUser.login,
              reason: decision.reason,
            });
            return reply.redirect("/?error=signups_closed");
          }
        }

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

        // OAuth authentication becomes known partway through this request, so
        // establish a fresh request context before any later reports or errors.
        posthog?.enterContext(
          { distinctId: user._id.toString() },
          { fresh: true },
        );
        posthog?.identify({
          distinctId: user._id.toString(),
          properties: {
            email: user.email,
            name: user.name,
            github_login: user.githubLogin,
          },
        });

        // Create session
        const sessionToken = sessionService.createSession({
          userId: user._id,
          accountId,
        });

        // Set session cookie
        reply.setCookie(
          "session",
          sessionToken,
          sessionCookieOptions(cookieSecure),
        );

        analytics?.identify(
          user._id.toString(),
          {
            login: user.githubLogin,
            email: user.email,
          },
          { accountId: accountId!.toString() },
        );
        analytics?.track(
          "user_logged_in",
          {
            userId: user._id.toString(),
            isNewUser,
          },
          {
            accountId: accountId!.toString(),
            distinctId: user._id.toString(),
          },
        );

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
      analytics?.track(
        "user_logged_out",
        {},
        {
          accountId: request.session?.accountId,
          distinctId: request.session?.userId,
        },
      );
      reply.clearCookie("session", { path: "/" });
      return reply.redirect("/");
    },
  );
}
