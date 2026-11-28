import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { getDeliveryMetricsTool, DeliveryMetrics } from "./getDeliveryMetrics";
import { ToolRefused } from "../tool";
import { FakeWorkspace, aCaller, aService } from "../fakes";
import { FourKeys, MeasurementWindow } from "../../dora/fourKeys";

const caller = aCaller(["builds:read"]);
const NOW = new Date("2026-11-27T12:00:00Z");

const keys = {
  deploymentFrequencyPerDay: 1.5,
  medianLeadTimeMs: 3_600_000,
  changeFailureRate: 0.1,
  medianTimeToRestoreMs: 600_000,
  sample: { deployments: 45, failures: 4, restores: 4, leadTimes: 45 },
} as unknown as FourKeys;

// Records what was measured, so the window can be asserted on.
class FakeMetrics implements DeliveryMetrics {
  asked: { environment: string; window: MeasurementWindow }[] = [];
  async forService(
    _accountId: ObjectId,
    _serviceId: ObjectId,
    environment: string,
    window: MeasurementWindow,
  ): Promise<FourKeys> {
    this.asked.push({ environment, window });
    return keys;
  }
}

describe("get_delivery_metrics", () => {
  it("should need only permission to read builds", () => {
    const tool = getDeliveryMetricsTool(
      new FakeWorkspace(),
      new FakeMetrics(),
      () => NOW,
    );

    expect(tool.name).toBe("get_delivery_metrics");
    expect(tool.requiredScope).toBe("builds:read");
    expect(tool.changes).toBe(false);
  });

  it("should measure the last 30 days of one environment by default", async () => {
    const service = aService();
    const metrics = new FakeMetrics();

    const result = await getDeliveryMetricsTool(
      new FakeWorkspace([service]),
      metrics,
      () => NOW,
    ).run(caller, { serviceId: service._id.toString(), environment: "prod" });

    const from = new Date("2026-10-28T12:00:00Z");
    expect(metrics.asked).toEqual([
      { environment: "prod", window: { from, to: NOW } },
    ]);
    expect(result).toEqual({
      environment: "prod",
      window: { from, to: NOW, days: 30 },
      ...keys,
    });
  });

  it("should measure the number of days asked for", async () => {
    const service = aService();
    const metrics = new FakeMetrics();

    await getDeliveryMetricsTool(
      new FakeWorkspace([service]),
      metrics,
      () => NOW,
    ).run(caller, {
      serviceId: service._id.toString(),
      environment: "prod",
      days: 7,
    });

    expect(metrics.asked[0].window.from).toEqual(
      new Date("2026-11-20T12:00:00Z"),
    );
  });

  it("should refuse an environment the service does not have, and list the ones it does", async () => {
    const service = aService();
    const metrics = new FakeMetrics();

    const attempt = getDeliveryMetricsTool(
      new FakeWorkspace([service]),
      metrics,
      () => NOW,
    ).run(caller, {
      serviceId: service._id.toString(),
      environment: "production",
    });

    await expect(attempt).rejects.toThrow(ToolRefused);
    await expect(attempt).rejects.toThrow(
      'Unknown environment "production". This service has: staging, prod.',
    );
    expect(metrics.asked).toEqual([]);
  });
});
