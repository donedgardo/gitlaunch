import { AnalyticsService } from "../analytics/analytics";
import { FlagServiceI } from "../flag/flagService";
import { FlagAttributes } from "../flag/flagEvaluator";
import { SelfFlagAccount, SelfFlagContext } from "../flag/selfFlagContext";
import { ServiceRepository } from "../../repositories/serviceRepository";

// Dogfooding: GitLaunch decides whether the front door is open — whether a
// brand-new visitor may create an account — with its own feature-flag engine.
// Flag ON => self-serve signup allowed. That gives us, for free:
//   - a kill switch for signups (flip enabled off during an incident),
//   - gradual opening of the alpha (rolloutPercentage),
//   - allow-lists for specific people (targeting rules on githubLogin).
//
// The flag only gates *creating a new account*. Existing customers signing in
// and invited teammates joining a workspace are never touched by it.
export const SIGNUP_FLAG_KEY = "self-serve-signups";

// Same event name the rest of the flag tooling uses, so signup decisions show
// up in the standard exposure stream (and any experiment results built on it).
export const SIGNUP_EXPOSURE_EVENT = "flag_exposure";

export type SignupGateConfig = SelfFlagContext;

export type SignupDecision = {
  allowed: boolean;
  // Why: a flag evaluation reason ("disabled"/"rollout"/"targeting_rule"/...),
  // or how the gate opted out ("unconfigured"/"missing"/"error").
  reason: string;
  variant: string | null;
};

export class SignupGate {
  private account: SelfFlagAccount;

  constructor(
    private flags: FlagServiceI,
    services: ServiceRepository,
    private analytics: AnalyticsService,
    private config: SignupGateConfig,
  ) {
    this.account = new SelfFlagAccount(services, config);
  }

  get configured(): boolean {
    return this.account.configured;
  }

  // Decide whether this prospect may create an account.
  //
  // Fails OPEN on every path where we cannot get a real answer (no service
  // configured, flag not created yet, lookup blew up): a flag outage or a
  // half-finished setup must never be able to lock new customers out. Closing
  // the door is only ever an explicit act — someone turning the flag off.
  async allows(
    entityKey: string,
    attributes: FlagAttributes = {},
  ): Promise<SignupDecision> {
    if (!this.configured || !entityKey) {
      return this.open("unconfigured");
    }
    const accountId = await this.account.resolve();
    if (!accountId) {
      return this.open("unconfigured");
    }
    try {
      const evaluation = await this.flags.evaluateOne(
        accountId,
        this.config.serviceId!,
        this.config.environment,
        SIGNUP_FLAG_KEY,
        entityKey,
        attributes,
      );
      if (!evaluation) return this.open("missing");
      return {
        allowed: evaluation.enabled,
        reason: evaluation.reason,
        variant: evaluation.variant,
      };
    } catch {
      return this.open("error");
    }
  }

  private open(reason: string): SignupDecision {
    return { allowed: true, reason, variant: null };
  }

  async recordExposure(
    entityKey: string,
    decision: SignupDecision,
  ): Promise<void> {
    const accountId = await this.account.resolve();
    if (!accountId || !this.config.serviceId || !entityKey) return;
    this.analytics.track(
      SIGNUP_EXPOSURE_EVENT,
      {
        serviceId: this.config.serviceId.toString(),
        flagKey: SIGNUP_FLAG_KEY,
        environment: this.config.environment,
        variant: decision.variant,
        reason: decision.reason,
        allowed: decision.allowed,
      },
      {
        accountId: accountId.toString(),
        distinctId: entityKey,
      },
    );
  }
}

// Stable, anonymous-ish identity for a prospect who has no account yet. Uses the
// GitHub user id (immutable, unlike the login) so deterministic bucketing puts
// the same person in the same arm on every retry of the OAuth dance.
export function signupEntityKey(githubId: number): string {
  return `github:${githubId}`;
}

// Same idea for the other front doors, so every signup decision keys off a
// stable per-person identity and lands in the same rollout bucket on retry.
// Google's `sub` is its immutable account id; for email/password the normalized
// address is the only stable identity a not-yet-created user has. Namespaced by
// provider so the three key spaces can never collide.
export function googleSignupEntityKey(sub: string): string {
  return `google:${sub}`;
}

export function emailSignupEntityKey(email: string): string {
  return `email:${email}`;
}
