// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { AnalyticsService, AnalyticsContext } from "../analytics/analytics";
import { FlagServiceI } from "../flag/flagService";
import { FlagEvaluation, FlagAttributes } from "../flag/flagEvaluator";
import { ServiceRepository } from "../../repositories/serviceRepository";
import {
  SignupGate,
  SIGNUP_FLAG_KEY,
  SIGNUP_EXPOSURE_EVENT,
} from "./signupGate";

// Records analytics calls (including the warehouse context arg) so we can assert
// the gate streams an exposure for every signup decision it makes.
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

// Fake flag engine: returns whatever evaluation we preload for our flag key and
// remembers the args, so we can assert the gate derives the owning account from
// the service and forwards the prospect's attributes for targeting rules.
class FakeFlags implements Partial<FlagServiceI> {
  calls: {
    accountId: string;
    key: string;
    entityKey: string;
    env: string;
    attributes?: FlagAttributes;
  }[] = [];
  constructor(private result: FlagEvaluation | null) {}
  async evaluateOne(
    accountId: ObjectId,
    _serviceId: ObjectId,
    envName: string,
    key: string,
    entityKey: string,
    attributes?: FlagAttributes,
  ): Promise<FlagEvaluation | null> {
    this.calls.push({
      accountId: accountId.toString(),
      key,
      entityKey,
      env: envName,
      attributes,
    });
    return this.result;
  }
}

class ExplodingFlags implements Partial<FlagServiceI> {
  async evaluateOne(): Promise<FlagEvaluation | null> {
    throw new Error("flag store unavailable");
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
const PROSPECT = "github:12345";

function makeGate(
  flags: Partial<FlagServiceI>,
  analytics: AnalyticsService,
  overrides: Partial<{ serviceId?: ObjectId; environment: string }> = {},
  services: FakeServices = new FakeServices(ACCOUNT),
) {
  return new SignupGate(
    flags as FlagServiceI,
    services as unknown as ServiceRepository,
    analytics,
    { serviceId: SERVICE, environment: "prod", ...overrides },
  );
}

function evaluation(over: Partial<FlagEvaluation> = {}): FlagEvaluation {
  return {
    key: SIGNUP_FLAG_KEY,
    enabled: true,
    variant: null,
    reason: "rollout",
    ...over,
  };
}

describe("SignupGate", () => {
  let analytics: RecordingAnalytics;

  beforeEach(() => {
    analytics = new RecordingAnalytics();
  });

  describe("allows", () => {
    it("should let a prospect sign up when the flag is on for them", async () => {
      // Given the self-serve-signups flag evaluates on for this prospect
      const gate = makeGate(new FakeFlags(evaluation()), analytics);

      // When the gate is asked about them
      const decision = await gate.allows(PROSPECT);

      // Then signup proceeds
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe("rollout");
    });

    it("should block a prospect when the flag is off for them", async () => {
      // Given the flag evaluates off (signups closed for this prospect)
      const gate = makeGate(
        new FakeFlags(evaluation({ enabled: false, reason: "disabled" })),
        analytics,
      );

      // When the gate is asked about them
      const decision = await gate.allows(PROSPECT);

      // Then signup is refused
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("disabled");
    });

    it("should let a prospect through when a targeting rule serves them the flag", async () => {
      // Given an allow-list rule matched this prospect
      const gate = makeGate(
        new FakeFlags(evaluation({ enabled: true, reason: "targeting_rule" })),
        analytics,
      );

      // When the gate is asked about them
      const decision = await gate.allows(PROSPECT, { githubLogin: "octocat" });

      // Then signup proceeds
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe("targeting_rule");
    });

    it("should allow signups when no flag has been created yet", async () => {
      // Given the flag does not exist for the service
      const gate = makeGate(new FakeFlags(null), analytics);

      // When the gate is asked about a prospect
      const decision = await gate.allows(PROSPECT);

      // Then it fails open — signups keep working until someone opts in
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe("missing");
    });

    it("should allow signups when the platform's own service is not configured", async () => {
      // Given no GitLaunch service is wired up for self-flagging
      const gate = makeGate(
        new FakeFlags(evaluation({ enabled: false })),
        analytics,
        {
          serviceId: undefined,
        },
      );

      // When the gate is asked about a prospect
      const decision = await gate.allows(PROSPECT);

      // Then it stays out of the way
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe("unconfigured");
    });

    it("should allow signups when the configured service cannot be found", async () => {
      // Given the configured service id points at nothing
      const gate = makeGate(
        new FakeFlags(evaluation({ enabled: false })),
        analytics,
        {},
        new FakeServices(null),
      );

      // When the gate is asked about a prospect
      const decision = await gate.allows(PROSPECT);

      // Then signups are not held hostage by a bad config
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe("unconfigured");
    });

    it("should allow signups when the flag lookup fails", async () => {
      // Given the flag store is unavailable
      const gate = makeGate(new ExplodingFlags(), analytics);

      // When the gate is asked about a prospect
      const decision = await gate.allows(PROSPECT);

      // Then an outage never locks new customers out
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe("error");
    });

    it("should evaluate our own flag against the account that owns the service", async () => {
      // Given a service owned by an account
      const flags = new FakeFlags(evaluation());
      const gate = makeGate(flags, analytics);

      // When a prospect is evaluated with attributes
      await gate.allows(PROSPECT, { githubLogin: "octocat" });

      // Then the account is derived from the service, and the prospect's
      // attributes reach the evaluator so targeting rules can match them
      expect(flags.calls).toEqual([
        {
          accountId: ACCOUNT.toString(),
          key: SIGNUP_FLAG_KEY,
          entityKey: PROSPECT,
          env: "prod",
          attributes: { githubLogin: "octocat" },
        },
      ]);
    });
  });

  describe("recordExposure", () => {
    it("should stream the signup decision as a flag exposure for the prospect", async () => {
      // Given a decision was made for a prospect
      const gate = makeGate(
        new FakeFlags(evaluation({ enabled: false, reason: "disabled" })),
        analytics,
      );
      const decision = await gate.allows(PROSPECT);

      // When the exposure is recorded
      await gate.recordExposure(PROSPECT, decision);

      // Then it is attributed to our account and the prospect
      const exposure = analytics.tracked.find(
        (t) => t.event === SIGNUP_EXPOSURE_EVENT,
      );
      expect(exposure?.properties).toMatchObject({
        flagKey: SIGNUP_FLAG_KEY,
        environment: "prod",
        reason: "disabled",
        allowed: false,
      });
      expect(exposure?.context).toMatchObject({
        accountId: ACCOUNT.toString(),
        distinctId: PROSPECT,
      });
    });

    it("should not stream exposures when the platform service is not configured", async () => {
      // Given no service is wired up
      const gate = makeGate(new FakeFlags(null), analytics, {
        serviceId: undefined,
      });
      const decision = await gate.allows(PROSPECT);

      // When the exposure is recorded
      await gate.recordExposure(PROSPECT, decision);

      // Then nothing is tracked — there is no experiment running
      expect(analytics.tracked).toEqual([]);
    });
  });
});
