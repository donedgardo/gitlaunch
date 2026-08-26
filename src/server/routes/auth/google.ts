import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomBytes } from "crypto";
import { GoogleOAuthService } from "../../../services/auth/googleOAuthService";
import { SessionService } from "../../../services/auth/sessionService";
import { UserRepository } from "../../../repositories/userRepository";
import { AccountRepository } from "../../../repositories/accountRepository";
import { MembershipRepository } from "../../../repositories/membershipRepository";
import { AnalyticsService } from "../../../services/analytics/analytics";
import {
  AccountLimitReachedError,
  ensureAccountForUser,
} from "../../../services/auth/accountBootstrap";
import {
  SignupGate,
  googleSignupEntityKey,
} from "../../../services/account/signupGate";
import { sessionCookieOptions, oauthStateCookieOptions } from "../../cookies";

export type GoogleAuthRoutesConfig = {
  cookieSecure: boolean;
  useFakeGoogle: boolean;
  oauthService: GoogleOAuthService;
  sessionService: SessionService;
  userRepository: UserRepository;
  accountRepository: AccountRepository;
  membershipRepository: MembershipRepository;
  // Optional: when present, creating a *new* account via Google is gated by
  // GitLaunch's own self-serve-signups flag (same kill switch as GitHub and
  // email/password). Absent => signups always open.
  signupGate?: SignupGate;
  analytics?: AnalyticsService;
  // How many accounts this instance may hold. 1 on an unlicensed self-hosted
  // install; absent (uncapped) on the hosted product and licensed installs.
  maxAccounts?: number;
};

export function registerGoogleAuthRoutes(
  app: FastifyInstance,
  config: GoogleAuthRoutesConfig,
): void {
  const {
    cookieSecure,
    useFakeGoogle,
    oauthService,
    sessionService,
    userRepository,
    accountRepository,
    membershipRepository,
    signupGate,
    analytics,
    maxAccounts,
  } = config;

  // GET /auth/google - Redirect to Google OAuth
  app.get(
    "/auth/google",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const state = randomBytes(16).toString("hex");

      reply.setCookie(
        "oauth_state",
        state,
        oauthStateCookieOptions(cookieSecure),
      );

      // In fake mode, skip real Google entirely and bounce to our own callback
      // with a dummy code. Mirrors the GitHub fake-mode short-circuit.
      if (useFakeGoogle) {
        return reply.redirect(
          `/auth/google/callback?code=fake-dev-code&state=${state}`,
        );
      }

      const authUrl = oauthService.getAuthorizationUrl(state);
      return reply.redirect(authUrl);
    },
  );

  // GET /auth/google/callback - Handle OAuth callback
  app.get(
    "/auth/google/callback",
    async (
      request: FastifyRequest<{
        Querystring: { code?: string; state?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { code } = request.query;

      if (!code) {
        return reply.redirect("/?error=auth_failed");
      }

      try {
        const tokenResponse = await oauthService.exchangeCodeForToken(code);
        const googleUser = await oauthService.getUserInfo(
          tokenResponse.access_token,
        );

        // Who is signing in, and do they already belong somewhere? Answer this
        // *before* touching the database so a refused signup leaves no trace.
        const existingUser = await userRepository.findByGoogleId(
          googleUser.sub,
        );
        const memberships = existingUser
          ? await membershipRepository.findByUserId(existingUser._id)
          : [];

        // Dogfooding our own feature flags: a visitor with no membership is a
        // brand-new account, which is exactly what the flag gates. The gate
        // fails open, so this only refuses when someone deliberately turned
        // self-serve signups off. No githubLogin here, so allow-list rules
        // never match a Google signup — only the kill switch and rollout do.
        if (memberships.length === 0 && signupGate) {
          const entityKey = googleSignupEntityKey(googleUser.sub);
          const decision = await signupGate.allows(entityKey);
          void signupGate.recordExposure(entityKey, decision);
          if (!decision.allowed) {
            analytics?.track("signup_blocked", {
              method: "google",
              reason: decision.reason,
            });
            return reply.redirect("/?error=signups_closed");
          }
        }

        const user = await userRepository.findOrCreateByGoogleId({
          googleId: googleUser.sub,
          email: googleUser.email,
          name: googleUser.name,
          avatarUrl: googleUser.picture,
        });

        // Derive a friendly account name/slug from the profile, falling back to
        // the email local-part when the display name is missing.
        const seed =
          googleUser.name ||
          (googleUser.email ? googleUser.email.split("@")[0] : "user");
        const { accountId, isNewUser } = await ensureAccountForUser({
          userId: user._id,
          accountName: `${seed}'s Account`,
          slugSeed: seed,
          accountRepository,
          membershipRepository,
          maxAccounts,
        });

        const sessionToken = sessionService.createSession({
          userId: user._id,
          accountId,
        });

        reply.setCookie(
          "session",
          sessionToken,
          sessionCookieOptions(cookieSecure),
        );

        const distinctId = user._id.toString();
        analytics?.identify(
          distinctId,
          { email: user.email, name: user.name },
          { accountId: accountId.toString() },
        );
        analytics?.track(
          "user_logged_in",
          { isNewUser, method: "google" },
          { accountId: accountId.toString(), distinctId },
        );

        if (isNewUser) {
          return reply.redirect("/onboarding/plan-selection");
        }

        return reply.redirect("/dashboard");
      } catch (error) {
        if (error instanceof AccountLimitReachedError) {
          return reply.redirect("/login?error=single_tenant");
        }
        console.error("Google OAuth error:", error);
        return reply.redirect("/?error=auth_failed");
      }
    },
  );
}
