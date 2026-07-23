import { AnalyticsService } from "../analytics/analytics";
import { FlagServiceI } from "../flag/flagService";
import { SelfFlagAccount, SelfFlagContext } from "../flag/selfFlagContext";
import { ServiceRepository } from "../../repositories/serviceRepository";

// Dogfooding: GitLaunch runs an A/B test on its own alpha-waitlist landing page
// through GitLaunch's own feature-flag engine. The flag decides *which* variant
// a visitor is in; the copy for each variant lives here in code (the flag only
// stores variant keys + weights). Control === the current live landing copy, so
// a disabled/misconfigured flag is a safe no-op that shows today's page.

// Event names mirror the flag experiment-metrics convention so this dogfood data
// is readable by ExperimentResultsService if/when that layer lands on main.
export const WAITLIST_EXPOSURE_EVENT = "flag_exposure";
export const WAITLIST_CONVERSION_EVENT = "flag_conversion";
export const WAITLIST_CONVERSION_GOAL = "waitlist_signup";
export const WAITLIST_CONTROL_VARIANT = "control";

// Fixed contract between the code (variant->copy map below) and the flag stored
// in the flags UI. Not a per-deploy knob — the copy map only makes sense for
// this one flag, so it's hardcoded rather than env-configurable.
export const WAITLIST_FLAG_KEY = "waitlist-hero-copy";

// Stable anonymous visitor id. Deterministic bucketing needs the same entity on
// the page view (exposure) and the form submit (conversion), so both routes read
// this cookie; the landing route mints it on first visit.
export const WAITLIST_VISITOR_COOKIE = "gl_vid";

// The copy slots the experiment can vary on the landing page. heroHeadlineHtml
// is rendered raw (it carries the control markup), the rest are plain text.
export type WaitlistCopy = {
  heroHeadlineHtml: string;
  heroCta: string;
  ctaKicker: string;
  ctaHeading: string;
  ctaSubmit: string;
};

// Control must equal the strings currently in index.hbs so "flag off" is
// indistinguishable from today's page.
const CONTROL_COPY: WaitlistCopy = {
  heroHeadlineHtml:
    'Know exactly what\'s deployed where.<br><span class="u">Roll it back in one click.</span>',
  heroCta: "Join the waitlist →",
  ctaKicker: "Join the waitlist · limited early spots",
  ctaHeading: "Get early access.",
  ctaSubmit: "Request access →",
};

// The shipped challenger: leads with the concrete outcome instead of the
// program ("alpha/waitlist"). Add more arms here + in the flag's variant weights.
const BENEFIT_LED_COPY: WaitlistCopy = {
  heroHeadlineHtml:
    'See every deploy, in every environment.<br><span class="u">Ship and roll back with one click.</span>',
  heroCta: "See your deploys →",
  ctaKicker: "Private alpha · limited early spots",
  ctaHeading: "See every deploy in one place.",
  ctaSubmit: "Get my invite →",
};

const VARIANT_COPY: Record<string, WaitlistCopy> = {
  [WAITLIST_CONTROL_VARIANT]: CONTROL_COPY,
  "benefit-led": BENEFIT_LED_COPY,
};

// Shared self-flag scope (service + environment); the flag key is fixed
// (WAITLIST_FLAG_KEY), not part of this config.
export type WaitlistExperimentConfig = SelfFlagContext;

export type ResolvedVariant = {
  variant: string;
  reason: string;
  copy: WaitlistCopy;
};

export class WaitlistExperiment {
  // The account owning the configured service — derived from serviceId, since a
  // service belongs to exactly one account. Returns null when unconfigured or
  // the service can't be found, and callers then fall back to control.
  private account: SelfFlagAccount;

  constructor(
    private flags: FlagServiceI,
    services: ServiceRepository,
    private analytics: AnalyticsService,
    private config: WaitlistExperimentConfig,
  ) {
    this.account = new SelfFlagAccount(services, config);
  }

  // Whether the experiment is wired to a service. Off => always control.
  get configured(): boolean {
    return this.account.configured;
  }

  copyFor(variant: string): WaitlistCopy {
    return VARIANT_COPY[variant] ?? CONTROL_COPY;
  }

  static controlCopy(): WaitlistCopy {
    return CONTROL_COPY;
  }

  // Decide the variant for a stable visitor id. Reuses the flag service's
  // cached, deterministic evaluation so the marketing hot path stays fast and
  // the same visitor always sees the same arm. Never throws into the page.
  async resolve(entityKey: string): Promise<ResolvedVariant> {
    if (!this.configured || !entityKey) {
      return this.control("unconfigured");
    }
    const accountId = await this.account.resolve();
    if (!accountId) {
      // Configured service doesn't exist (yet) — behave as if flag is off.
      return this.control("unconfigured");
    }
    try {
      const evaluations = await this.flags.evaluate(
        accountId,
        this.config.serviceId!,
        this.config.environment,
        entityKey,
      );
      const mine = evaluations.find((e) => e.key === WAITLIST_FLAG_KEY);
      if (!mine) return this.control("missing");
      const variant = mine.variant ?? WAITLIST_CONTROL_VARIANT;
      return { variant, reason: mine.reason, copy: this.copyFor(variant) };
    } catch {
      // A flag lookup must never break the landing page — fail to control.
      return this.control("error");
    }
  }

  private control(reason: string): ResolvedVariant {
    return {
      variant: WAITLIST_CONTROL_VARIANT,
      reason,
      copy: CONTROL_COPY,
    };
  }

  async recordExposure(
    entityKey: string,
    resolved: ResolvedVariant,
  ): Promise<void> {
    const accountId = await this.account.resolve();
    if (!accountId || !this.config.serviceId || !entityKey) return;
    this.analytics.track(
      WAITLIST_EXPOSURE_EVENT,
      {
        serviceId: this.config.serviceId.toString(),
        flagKey: WAITLIST_FLAG_KEY,
        environment: this.config.environment,
        variant: resolved.variant,
        reason: resolved.reason,
      },
      {
        accountId: accountId.toString(),
        distinctId: entityKey,
      },
    );
  }

  async recordConversion(
    entityKey: string,
    variant: string,
    goal: string = WAITLIST_CONVERSION_GOAL,
  ): Promise<void> {
    const accountId = await this.account.resolve();
    if (!accountId || !this.config.serviceId || !entityKey) return;
    this.analytics.track(
      WAITLIST_CONVERSION_EVENT,
      {
        serviceId: this.config.serviceId.toString(),
        flagKey: WAITLIST_FLAG_KEY,
        environment: this.config.environment,
        variant,
        goal,
      },
      {
        accountId: accountId.toString(),
        distinctId: entityKey,
      },
    );
  }
}
