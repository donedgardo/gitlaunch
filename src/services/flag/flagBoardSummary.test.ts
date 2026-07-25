import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { Flag, FlagEnvironmentConfig } from "../../repositories/flagRepository";
import { summarizeEnvironmentFlags } from "./flagBoardSummary";

const env = (patch: Partial<FlagEnvironmentConfig> = {}) => ({
  enabled: false,
  rolloutPercentage: 0,
  variants: [],
  targetingRules: [],
  ...patch,
});

const flag = (
  key: string,
  environments: Record<string, FlagEnvironmentConfig>,
): Flag => ({
  _id: new ObjectId(),
  accountId: new ObjectId(),
  serviceId: new ObjectId(),
  key,
  description: `the ${key} flag`,
  environments,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("summarizeEnvironmentFlags", () => {
  it("should report that there is nothing to show when the service has no flags", () => {
    const [staging] = summarizeEnvironmentFlags([], ["staging"]);

    expect(staging.hasFlags).toBe(false);
    expect(staging.total).toBe(0);
    expect(staging.on).toBe(0);
  });

  it("should count how many of the service's flags are on in each environment", () => {
    const flags = [
      flag("new-checkout", {
        staging: env({ enabled: true, rolloutPercentage: 100 }),
        prod: env({ enabled: false }),
      }),
      flag("dark-mode", {
        staging: env({ enabled: true, rolloutPercentage: 100 }),
        prod: env({ enabled: true, rolloutPercentage: 100 }),
      }),
    ];

    const [staging, prod] = summarizeEnvironmentFlags(flags, [
      "staging",
      "prod",
    ]);

    expect(staging.on).toBe(2);
    expect(staging.total).toBe(2);
    expect(prod.on).toBe(1);
    expect(prod.total).toBe(2);
  });

  it("should treat a flag with no config for an environment as off there", () => {
    const flags = [flag("new-checkout", { staging: env({ enabled: true }) })];

    const [prod] = summarizeEnvironmentFlags(flags, ["prod"]);

    expect(prod.on).toBe(0);
    // The flag still belongs to the service, so it counts toward the total.
    expect(prod.total).toBe(1);
    expect(prod.hasFlags).toBe(true);
  });

  it("should report a flag that is on for only part of traffic as rolling out", () => {
    const flags = [
      flag("new-checkout", {
        prod: env({ enabled: true, rolloutPercentage: 25 }),
      }),
    ];

    const [prod] = summarizeEnvironmentFlags(flags, ["prod"]);

    expect(prod.on).toBe(1);
    expect(prod.rollingOut).toBe(1);
  });

  it("should not report a fully rolled out flag as rolling out", () => {
    const flags = [
      flag("dark-mode", {
        prod: env({ enabled: true, rolloutPercentage: 100 }),
      }),
    ];

    const [prod] = summarizeEnvironmentFlags(flags, ["prod"]);

    expect(prod.rollingOut).toBe(0);
  });

  it("should report an enabled flag that splits traffic between variants as an experiment", () => {
    const flags = [
      flag("hero-copy", {
        prod: env({
          enabled: true,
          rolloutPercentage: 100,
          variants: [
            { key: "control", weight: 50 },
            { key: "benefit-led", weight: 50 },
          ],
        }),
      }),
    ];

    const [prod] = summarizeEnvironmentFlags(flags, ["prod"]);

    expect(prod.experiments).toBe(1);
  });

  it("should ignore rollout and variants of a flag that is switched off", () => {
    const flags = [
      flag("hero-copy", {
        prod: env({
          enabled: false,
          rolloutPercentage: 25,
          variants: [
            { key: "control", weight: 50 },
            { key: "benefit-led", weight: 50 },
          ],
        }),
      }),
    ];

    const [prod] = summarizeEnvironmentFlags(flags, ["prod"]);

    expect(prod.on).toBe(0);
    expect(prod.rollingOut).toBe(0);
    expect(prod.experiments).toBe(0);
  });

  it("should label the environment with how many flags are on out of the total", () => {
    const flags = [
      flag("a", { prod: env({ enabled: true, rolloutPercentage: 100 }) }),
      flag("b", { prod: env({ enabled: false }) }),
      flag("c", { prod: env({ enabled: false }) }),
    ];

    const [prod] = summarizeEnvironmentFlags(flags, ["prod"]);

    expect(prod.label).toBe("1 of 3 flags on");
  });

  it("should label a single flag without pluralising it", () => {
    const flags = [
      flag("a", { prod: env({ enabled: true, rolloutPercentage: 100 }) }),
    ];

    const [prod] = summarizeEnvironmentFlags(flags, ["prod"]);

    expect(prod.label).toBe("1 of 1 flag on");
  });

  it("should spell out rollouts and experiments in the detail so the board explains itself", () => {
    const flags = [
      flag("a", { prod: env({ enabled: true, rolloutPercentage: 25 }) }),
      flag("b", {
        prod: env({
          enabled: true,
          rolloutPercentage: 100,
          variants: [
            { key: "control", weight: 50 },
            { key: "next", weight: 50 },
          ],
        }),
      }),
    ];

    const [prod] = summarizeEnvironmentFlags(flags, ["prod"]);

    expect(prod.detail).toBe("1 rolling out · 1 experiment");
  });

  it("should leave the detail empty when every flag that is on is fully rolled out", () => {
    const flags = [
      flag("a", { prod: env({ enabled: true, rolloutPercentage: 100 }) }),
    ];

    const [prod] = summarizeEnvironmentFlags(flags, ["prod"]);

    expect(prod.detail).toBe("");
  });

  it("should name the environment it is summarising", () => {
    const summaries = summarizeEnvironmentFlags([], ["staging", "prod"]);

    expect(summaries.map((s) => s.environment)).toEqual(["staging", "prod"]);
  });
});
