import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomBytes } from "crypto";
import { GitHubOAuthService } from "../../../services/auth/githubOAuthService";
import { SessionService } from "../../../services/auth/sessionService";
import { UserRepository } from "../../../repositories/userRepository";
import { AccountRepository } from "../../../repositories/accountRepository";
import {
  MembershipRepository,
  MembershipRole,
} from "../../../repositories/membershipRepository";
import { AnalyticsService } from "../../../services/analytics/analytics";

export type GitHubAuthRoutesConfig = {
  oauthService: GitHubOAuthService;
  sessionService: SessionService;
  userRepository: UserRepository;
  accountRepository: AccountRepository;
  membershipRepository: MembershipRepository;
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

        // Check if user has any account membership
        const memberships = await membershipRepository.findByUserId(user._id);

        let accountId = memberships[0]?.accountId;

        // Track if this is a new user for onboarding redirect
        let isNewUser = false;
        let account = null;

        // If no account, create default account and membership (Phase 1.18)
        if (memberships.length === 0) {
          isNewUser = true;
          account = await accountRepository.create({
            name: `${githubUser.login}'s Account`,
            slug: githubUser.login.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
          });

          await membershipRepository.create({
            userId: user._id,
            accountId: account._id,
            role: MembershipRole.Owner,
          });

          accountId = account._id;
        } else {
          // Fetch existing account to check installation status
          account = await accountRepository.findById(memberships[0].accountId);
        }

        // Create session
        const sessionToken = sessionService.createSession({
          userId: user._id,
          accountId: accountId!,
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
