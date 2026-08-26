import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { randomBytes } from "crypto";
import { SessionService } from "../../../services/auth/sessionService";
import { UserRepository } from "../../../repositories/userRepository";
import { AccountRepository } from "../../../repositories/accountRepository";
import { MembershipRepository } from "../../../repositories/membershipRepository";
import { PasswordService } from "../../../services/auth/passwordService";
import { EmailSender } from "../../../services/email/emailSender";
import { AnalyticsService } from "../../../services/analytics/analytics";
import {
  AccountLimitReachedError,
  ensureAccountForUser,
} from "../../../services/auth/accountBootstrap";
import {
  SignupGate,
  emailSignupEntityKey,
} from "../../../services/account/signupGate";
import { sessionCookieOptions } from "../../cookies";

export type EmailPasswordAuthRoutesConfig = {
  sessionService: SessionService;
  userRepository: UserRepository;
  accountRepository: AccountRepository;
  membershipRepository: MembershipRepository;
  passwordService: PasswordService;
  emailSender: EmailSender;
  publicUrl: string;
  cookieSecure: boolean;
  googleEnabled?: boolean;
  // Optional: when present, creating a *new* account via email/password is gated
  // by GitLaunch's own self-serve-signups flag (same kill switch as GitHub and
  // Google). Absent => signups always open.
  signupGate?: SignupGate;
  analytics?: AnalyticsService;
  // How many accounts this instance may hold. 1 on an unlicensed self-hosted
  // install; absent (uncapped) on the hosted product and licensed installs.
  maxAccounts?: number;
};

const LAYOUT = { layout: "/layouts/main.hbs" };
const MIN_PASSWORD_LENGTH = 8;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  cookieSecure: boolean,
): void {
  reply.setCookie("session", token, sessionCookieOptions(cookieSecure));
}

export function registerEmailPasswordAuthRoutes(
  app: FastifyInstance,
  config: EmailPasswordAuthRoutesConfig,
): void {
  const {
    sessionService,
    userRepository,
    accountRepository,
    membershipRepository,
    passwordService,
    emailSender,
    publicUrl,
    cookieSecure,
    googleEnabled = false,
    signupGate,
    analytics,
    maxAccounts,
  } = config;

  // Both entry points below bootstrap an account the same way, and both can be
  // refused on a single-tenant instance. Returns null on refusal so the caller
  // shows an explanation rather than a 500.
  async function bootstrapAccount(userId: ObjectId, seed: string) {
    try {
      return await ensureAccountForUser({
        userId,
        accountName: `${seed}'s Account`,
        slugSeed: seed,
        accountRepository,
        membershipRepository,
        maxAccounts,
      });
    } catch (error) {
      if (error instanceof AccountLimitReachedError) return null;
      throw error;
    }
  }

  async function sendVerificationEmail(
    userId: ObjectId,
    email: string,
  ): Promise<void> {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
    await userRepository.setEmailVerificationToken(userId, token, expiresAt);

    const link = `${publicUrl}/auth/verify-email?token=${token}`;
    await emailSender.send({
      to: email,
      subject: "Confirm your GitLaunch email",
      text: `Welcome to GitLaunch! Confirm your email to finish signing up:\n\n${link}\n\nThis link expires in 24 hours. If you didn't sign up, you can ignore this email.`,
      html: `<p>Welcome to GitLaunch!</p><p>Confirm your email to finish signing up:</p><p><a href="${link}">Confirm my email</a></p><p>This link expires in 24 hours. If you didn't sign up, you can ignore this email.</p>`,
    });
  }

  // GET /login - render the login page (GitHub + Google + email/password)
  app.get("/login", async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.session) {
      return reply.redirect("/dashboard");
    }
    const { error, notice } = request.query as {
      error?: string;
      notice?: string;
    };
    return reply.view("login.hbs", { error, notice, googleEnabled }, LAYOUT);
  });

  // GET /signup - render the signup page
  app.get("/signup", async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.session) {
      return reply.redirect("/dashboard");
    }
    const { error } = request.query as { error?: string };
    return reply.view("signup.hbs", { error, googleEnabled }, LAYOUT);
  });

  // POST /auth/signup - create an unverified password user + send confirmation
  app.post(
    "/auth/signup",
    async (
      request: FastifyRequest<{
        Body: { name?: string; email?: string; password?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const name = request.body.name?.trim() || null;
      const email = request.body.email?.trim().toLowerCase() ?? "";
      const password = request.body.password ?? "";

      if (!EMAIL_RE.test(email)) {
        return reply.redirect("/signup?error=invalid_email");
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        return reply.redirect("/signup?error=weak_password");
      }

      const existing = await userRepository.findByEmail(email);
      if (existing) {
        // Don't reveal whether the address is registered — send them to login.
        return reply.redirect("/signup?error=email_taken");
      }

      // Dogfooding our own feature flags: creating a brand-new account is
      // exactly what the self-serve-signups flag gates. Run the check *before*
      // any write, so a refused signup leaves no orphan user and sends no email.
      // The gate fails open, so this only refuses when signups were deliberately
      // turned off. Existing customers (handled above) and logins are untouched.
      if (signupGate) {
        const entityKey = emailSignupEntityKey(email);
        const decision = await signupGate.allows(entityKey);
        void signupGate.recordExposure(entityKey, decision);
        if (!decision.allowed) {
          analytics?.track("signup_blocked", {
            method: "password",
            reason: decision.reason,
          });
          return reply.redirect("/?error=signups_closed");
        }
      }

      const passwordHash = await passwordService.hash(password);
      const user = await userRepository.createPasswordUser({
        email,
        passwordHash,
        name,
      });

      await sendVerificationEmail(user._id, email);

      const distinctId = user._id.toString();
      analytics?.identify(distinctId, { email: user.email, name: user.name });
      analytics?.track(
        "user_signed_up",
        { method: "password" },
        { distinctId },
      );

      return reply.view("check-email.hbs", { email }, LAYOUT);
    },
  );

  // GET /auth/verify-email - confirm the address, then log the user in
  app.get(
    "/auth/verify-email",
    async (
      request: FastifyRequest<{ Querystring: { token?: string } }>,
      reply: FastifyReply,
    ) => {
      const { token } = request.query;
      if (!token) {
        return reply.redirect("/login?error=invalid_token");
      }

      const user = await userRepository.findByEmailVerificationToken(token);
      if (!user) {
        return reply.redirect("/login?error=invalid_token");
      }

      if (
        user.emailVerificationExpiresAt &&
        user.emailVerificationExpiresAt.getTime() < Date.now()
      ) {
        return reply.redirect("/login?error=expired_token");
      }

      await userRepository.markEmailVerified(user._id);

      const seed = user.email ? user.email.split("@")[0] : "user";
      const bootstrap = await bootstrapAccount(user._id, seed);
      if (!bootstrap) {
        return reply.redirect("/login?error=single_tenant");
      }
      const { accountId, isNewUser } = bootstrap;

      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId,
      });
      setSessionCookie(reply, sessionToken, cookieSecure);

      const distinctId = user._id.toString();
      analytics?.identify(
        distinctId,
        { email: user.email, name: user.name },
        { accountId: accountId.toString() },
      );
      analytics?.track(
        "user_logged_in",
        { isNewUser, method: "password" },
        { accountId: accountId.toString(), distinctId },
      );

      // A fresh confirmation always means a first login → onboarding.
      return reply.redirect("/onboarding/plan-selection");
    },
  );

  // POST /auth/login - email + password login
  app.post(
    "/auth/login",
    async (
      request: FastifyRequest<{
        Body: { email?: string; password?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const email = request.body.email?.trim().toLowerCase() ?? "";
      const password = request.body.password ?? "";

      const user = await userRepository.findByEmail(email);
      // Same response for unknown user and wrong password to avoid enumeration.
      if (!user || !user.passwordHash) {
        return reply.redirect("/login?error=invalid_credentials");
      }

      const valid = await passwordService.verify(password, user.passwordHash);
      if (!valid) {
        return reply.redirect("/login?error=invalid_credentials");
      }

      if (!user.emailVerified) {
        return reply.redirect("/login?error=unverified");
      }

      const seed = user.email ? user.email.split("@")[0] : "user";
      const bootstrap = await bootstrapAccount(user._id, seed);
      if (!bootstrap) {
        return reply.redirect("/login?error=single_tenant");
      }
      const { accountId } = bootstrap;

      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId,
      });
      setSessionCookie(reply, sessionToken, cookieSecure);

      const distinctId = user._id.toString();
      analytics?.identify(
        distinctId,
        { email: user.email, name: user.name },
        { accountId: accountId.toString() },
      );
      analytics?.track(
        "user_logged_in",
        { isNewUser: false, method: "password" },
        { accountId: accountId.toString(), distinctId },
      );

      return reply.redirect("/dashboard");
    },
  );

  // POST /auth/resend-verification - re-send the confirmation email
  app.post(
    "/auth/resend-verification",
    async (
      request: FastifyRequest<{ Body: { email?: string } }>,
      reply: FastifyReply,
    ) => {
      const email = request.body.email?.trim().toLowerCase() ?? "";
      const user = await userRepository.findByEmail(email);

      // Only re-send for genuine unverified password accounts, but always show
      // the same confirmation page so we don't leak which emails exist.
      if (user && user.passwordHash && !user.emailVerified) {
        await sendVerificationEmail(user._id, email);
      }

      return reply.view("check-email.hbs", { email }, LAYOUT);
    },
  );
}
