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
import { ensureAccountForUser } from "../../../services/auth/accountBootstrap";
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
  } = config;

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

      analytics?.track("user_signed_up", {
        userId: user._id.toString(),
        method: "password",
      });

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
      const { accountId, isNewUser } = await ensureAccountForUser({
        userId: user._id,
        accountName: `${seed}'s Account`,
        slugSeed: seed,
        accountRepository,
        membershipRepository,
      });

      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId,
      });
      setSessionCookie(reply, sessionToken, cookieSecure);

      analytics?.identify(user._id.toString(), { email: user.email });
      analytics?.track("user_logged_in", {
        userId: user._id.toString(),
        isNewUser,
        method: "password",
      });

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
      const { accountId } = await ensureAccountForUser({
        userId: user._id,
        accountName: `${seed}'s Account`,
        slugSeed: seed,
        accountRepository,
        membershipRepository,
      });

      const sessionToken = sessionService.createSession({
        userId: user._id,
        accountId,
      });
      setSessionCookie(reply, sessionToken, cookieSecure);

      analytics?.track("user_logged_in", {
        userId: user._id.toString(),
        isNewUser: false,
        method: "password",
      });

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
