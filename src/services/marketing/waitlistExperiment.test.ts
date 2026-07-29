import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { AnalyticsService, AnalyticsContext } from "../analytics/analytics";
import { FlagServiceI } from "../flag/flagService";
import { FlagEvaluation } from "../flag/flagEvaluator";
import { ServiceRepository } from "../../repositories/serviceRepository";
import {
  WaitlistExperiment,
  WAITLIST_CONTROL_VARIANT,
  WAITLIST_EXPOSURE_EVENT,
  WAITLIST_CONVERSION_EVENT,
  WAITLIST_FLAG_KEY,
  WaitlistCopy,
} from "./waitlistExperiment";

// Records analytics calls (including the warehouse context arg) so we can assert
// the experiment actually streams exposure/conversion signals.
class RecordingAnalytics implements AnalyticsService {
  tracked: {
    event: string;
    properties?: Record<string, any>;
    context?: AnalyticsContext;
  }[] = [];
  identify(): void {}
  track(
    event: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    this.tracked.push({ event, properties, context });
  }
  navigation(): void {}
}

// Fake flag engine: returns whatever evaluation we preload, and remembers the
// args (incl. the account it was called with) so we can assert the experiment
// derives the account from the service and scopes evaluation to its own flag.
class FakeFlags implements Partial<FlagServiceI> {
  calls: { accountId: string; entityKey: string; env: string }[] = [];
  constructor(private results: FlagEvaluation[]) {}
  async evaluate(
    accountId: ObjectId,
    _serviceId: ObjectId,
    envName: string,
    entityKey: string,
  ): Promise<FlagEvaluation[]> {
    this.calls.push({
      accountId: accountId.toString(),
      entityKey,
      env: envName,
    });
    return this.results;
  }
}

// Fake service repo: findById yields a service owned by `accountId` (or null to
// simulate a missing/unconfigured service).
class FakeServices {
  calls: string[] = [];
  constructor(private accountId: ObjectId | null) {}
  async findById(id: ObjectId): Promise<any> {
    this.calls.push(id.toString());
    return this.accountId ? { _id: id, accountId: this.accountId } : null;
  }
}

const ACCOUNT = new ObjectId();
const SERVICE = new ObjectId();
const FLAG_KEY = WAITLIST_FLAG_KEY;

function makeExperiment(
  flags: Partial<FlagServiceI>,
  analytics: AnalyticsService,
  overrides: Partial<{ serviceId?: ObjectId; environment: string }> = {},
  services: FakeServices = new FakeServices(ACCOUNT),
  variants?: Record<string, WaitlistCopy>,
) {
  return new WaitlistExperiment(
    flags as FlagServiceI,
    services as unknown as ServiceRepository,
    analytics,
    { serviceId: SERVICE, environment: "prod", ...overrides },
    ...(variants ? [variants] : []),
  );
}

describe("WaitlistExperiment", () => {
  let analytics: RecordingAnalytics;

  beforeEach(() => {
    analytics = new RecordingAnalytics();
  });

  describe("resolve", () => {
    it("returns the assigned variant and its copy when the flag buckets a visitor", async () => {
      const flags = new FakeFlags([
        {
          key: FLAG_KEY,
          enabled: true,
          variant: "benefit-led",
          reason: "variant",
        },
      ]);
      const experiment = makeExperiment(flags, analytics);

      const resolved = await experiment.resolve("visitor-1");

      expect(resolved.variant).toBe("benefit-led");
      // The experiment is concluded: every arm now renders the shipped copy, so
      // a stale flag assignment can no longer change what a visitor reads.
      const control = experiment.copyFor(WAITLIST_CONTROL_VARIANT);
      expect(resolved.copy).toEqual(control);
      expect(resolved.reason).toBe("variant");
      // Account was derived from the service, not passed in config.
      expect(flags.calls[0]).toEqual({
        accountId: ACCOUNT.toString(),
        entityKey: "visitor-1",
        env: "prod",
      });
    });

    it("falls back to control copy when the flag is disabled", async () => {
      const flags = new FakeFlags([
        { key: FLAG_KEY, enabled: false, variant: null, reason: "disabled" },
      ]);
      const experiment = makeExperiment(flags, analytics);

      const resolved = await experiment.resolve("visitor-1");

      expect(resolved.variant).toBe(WAITLIST_CONTROL_VARIANT);
      expect(resolved.copy).toEqual(
        experiment.copyFor(WAITLIST_CONTROL_VARIANT),
      );
    });

    it("falls back to control when our flag is not among the service's flags", async () => {
      const flags = new FakeFlags([
        {
          key: "some-other-flag",
          enabled: true,
          variant: "x",
          reason: "variant",
        },
      ]);
      const experiment = makeExperiment(flags, analytics);

      const resolved = await experiment.resolve("visitor-1");

      expect(resolved.variant).toBe(WAITLIST_CONTROL_VARIANT);
    });

    it("returns control without evaluating when the experiment is not configured", async () => {
      const flags = new FakeFlags([]);
      const experiment = makeExperiment(flags, analytics, {
        serviceId: undefined,
      });

      const resolved = await experiment.resolve("visitor-1");

      expect(resolved.variant).toBe(WAITLIST_CONTROL_VARIANT);
      expect(flags.calls).toHaveLength(0);
    });

    it("returns control when the configured service can't be found", async () => {
      const flags = new FakeFlags([
        {
          key: FLAG_KEY,
          enabled: true,
          variant: "benefit-led",
          reason: "variant",
        },
      ]);
      // Service repo yields null => no account to scope by.
      const experiment = makeExperiment(
        flags,
        analytics,
        {},
        new FakeServices(null),
      );

      const resolved = await experiment.resolve("visitor-1");

      expect(resolved.variant).toBe(WAITLIST_CONTROL_VARIANT);
      expect(flags.calls).toHaveLength(0);
    });

    it("returns control without evaluating when there is no visitor entity", async () => {
      const flags = new FakeFlags([
        {
          key: FLAG_KEY,
          enabled: true,
          variant: "benefit-led",
          reason: "variant",
        },
      ]);
      const experiment = makeExperiment(flags, analytics);

      const resolved = await experiment.resolve("");

      expect(resolved.variant).toBe(WAITLIST_CONTROL_VARIANT);
      expect(flags.calls).toHaveLength(0);
    });
  });

  describe("copyFor", () => {
    it("returns control copy for an unknown variant key", () => {
      const experiment = makeExperiment(new FakeFlags([]), analytics);
      expect(experiment.copyFor("does-not-exist")).toEqual(
        experiment.copyFor(WAITLIST_CONTROL_VARIANT),
      );
    });
  });

  describe("recordExposure", () => {
    it("emits a flag_exposure event scoped to the tenant and visitor", async () => {
      const flags = new FakeFlags([
        {
          key: FLAG_KEY,
          enabled: true,
          variant: "benefit-led",
          reason: "variant",
        },
      ]);
      // A live, two-arm experiment — exposures are only worth recording when
      // there is something to compare them against.
      const experiment = makeExperiment(flags, analytics, {}, undefined, {
        control: WaitlistExperiment.controlCopy(),
        "benefit-led": {
          ...WaitlistExperiment.controlCopy(),
          heroCta: "Challenger CTA →",
        },
      });
      const resolved = await experiment.resolve("visitor-1");

      await experiment.recordExposure("visitor-1", resolved);

      expect(analytics.tracked).toHaveLength(1);
      const evt = analytics.tracked[0];
      expect(evt.event).toBe(WAITLIST_EXPOSURE_EVENT);
      expect(evt.properties).toMatchObject({
        flagKey: FLAG_KEY,
        environment: "prod",
        variant: "benefit-led",
        reason: "variant",
        serviceId: SERVICE.toString(),
      });
      expect(evt.context).toMatchObject({
        accountId: ACCOUNT.toString(),
        distinctId: "visitor-1",
      });
    });

    it("emits nothing when the experiment is not configured", async () => {
      const experiment = makeExperiment(new FakeFlags([]), analytics, {
        serviceId: undefined,
      });
      const resolved = await experiment.resolve("visitor-1");

      await experiment.recordExposure("visitor-1", resolved);

      expect(analytics.tracked).toHaveLength(0);
    });
  });

  describe("recordConversion", () => {
    it("emits a flag_conversion event attributed to the visitor's variant", async () => {
      const experiment = makeExperiment(new FakeFlags([]), analytics);

      await experiment.recordConversion("visitor-1", "benefit-led");

      expect(analytics.tracked).toHaveLength(1);
      const evt = analytics.tracked[0];
      expect(evt.event).toBe(WAITLIST_CONVERSION_EVENT);
      expect(evt.properties).toMatchObject({
        flagKey: FLAG_KEY,
        environment: "prod",
        variant: "benefit-led",
        goal: "waitlist_signup",
      });
      expect(evt.context).toMatchObject({
        accountId: ACCOUNT.toString(),
        distinctId: "visitor-1",
      });
    });

    it("emits nothing when the experiment is not configured", async () => {
      const experiment = makeExperiment(new FakeFlags([]), analytics, {
        serviceId: undefined,
      });

      await experiment.recordConversion("visitor-1", "benefit-led");

      expect(analytics.tracked).toHaveLength(0);
    });
  });

  // The hero-copy test was stopped: at ~125 exposures it needed ~25k more per
  // arm to detect a 20% change, so it could never reach a verdict. Concluding
  // it means one shipped copy and no further exposure rows to reason about.
  describe("once the experiment is concluded", () => {
    it("should serve the same copy to every visitor whatever variant they land in", async () => {
      const experiment = makeExperiment(new FakeFlags([]), analytics);
      const live = WaitlistExperiment.controlCopy();

      expect(experiment.copyFor("benefit-led")).toEqual(live);
      expect(experiment.copyFor("control")).toEqual(live);
      expect(experiment.copyFor("some-arm-added-later")).toEqual(live);
    });

    it("should lead the shipped copy with deploy visibility", async () => {
      const live = WaitlistExperiment.controlCopy();

      expect(live.heroHeadlineHtml).toContain("See every deploy");
      expect(live.heroCta).toBe("See your deploys →");
      expect(live.ctaSubmit).toBe("Get my invite →");
    });

    it("should record no exposures, because there is nothing left to compare", async () => {
      const flags = new FakeFlags([
        {
          key: FLAG_KEY,
          enabled: true,
          variant: "benefit-led",
          reason: "variant",
        },
      ]);
      const experiment = makeExperiment(flags, analytics);

      const resolved = await experiment.resolve("visitor-1");
      await experiment.recordExposure("visitor-1", resolved);

      expect(analytics.tracked).toHaveLength(0);
    });

    it("should still record conversions, so signups stay attributable", async () => {
      const experiment = makeExperiment(new FakeFlags([]), analytics);

      await experiment.recordConversion("visitor-1", WAITLIST_CONTROL_VARIANT);

      expect(analytics.tracked).toHaveLength(1);
      expect(analytics.tracked[0].event).toBe(WAITLIST_CONVERSION_EVENT);
    });
  });
});
