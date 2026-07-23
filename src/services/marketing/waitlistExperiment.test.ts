import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { AnalyticsService, AnalyticsContext } from "../analytics/analytics";
import { FlagServiceI } from "../flag/flagService";
import { FlagEvaluation } from "../flag/flagEvaluator";
import {
  WaitlistExperiment,
  WAITLIST_CONTROL_VARIANT,
  WAITLIST_EXPOSURE_EVENT,
  WAITLIST_CONVERSION_EVENT,
  WAITLIST_FLAG_KEY,
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
// args so we can assert the experiment scopes evaluation to its own flag.
class FakeFlags implements Partial<FlagServiceI> {
  calls: { entityKey: string; env: string }[] = [];
  constructor(private results: FlagEvaluation[]) {}
  async evaluate(
    _accountId: ObjectId,
    _serviceId: ObjectId,
    envName: string,
    entityKey: string,
  ): Promise<FlagEvaluation[]> {
    this.calls.push({ entityKey, env: envName });
    return this.results;
  }
}

const ACCOUNT = new ObjectId();
const SERVICE = new ObjectId();
const FLAG_KEY = WAITLIST_FLAG_KEY;

function makeExperiment(
  flags: Partial<FlagServiceI>,
  analytics: AnalyticsService,
  overrides: Partial<{
    accountId?: ObjectId;
    serviceId?: ObjectId;
    environment: string;
  }> = {},
) {
  return new WaitlistExperiment(flags as FlagServiceI, analytics, {
    accountId: ACCOUNT,
    serviceId: SERVICE,
    environment: "prod",
    ...overrides,
  });
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
      // Copy actually differs from control so the visitor sees the challenger.
      const control = experiment.copyFor(WAITLIST_CONTROL_VARIANT);
      expect(resolved.copy.heroCta).not.toBe(control.heroCta);
      expect(resolved.reason).toBe("variant");
      expect(flags.calls[0]).toEqual({ entityKey: "visitor-1", env: "prod" });
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
        accountId: undefined,
        serviceId: undefined,
      });

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
      const experiment = makeExperiment(flags, analytics);
      const resolved = await experiment.resolve("visitor-1");

      experiment.recordExposure("visitor-1", resolved);

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
        accountId: undefined,
        serviceId: undefined,
      });
      const resolved = await experiment.resolve("visitor-1");

      experiment.recordExposure("visitor-1", resolved);

      expect(analytics.tracked).toHaveLength(0);
    });
  });

  describe("recordConversion", () => {
    it("emits a flag_conversion event attributed to the visitor's variant", () => {
      const experiment = makeExperiment(new FakeFlags([]), analytics);

      experiment.recordConversion("visitor-1", "benefit-led");

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

    it("emits nothing when the experiment is not configured", () => {
      const experiment = makeExperiment(new FakeFlags([]), analytics, {
        accountId: undefined,
        serviceId: undefined,
      });

      experiment.recordConversion("visitor-1", "benefit-led");

      expect(analytics.tracked).toHaveLength(0);
    });
  });
});
