import { ObjectId } from "mongodb";
import { z } from "zod";
import { defineTool } from "../tool";
import {
  ServiceLookup,
  requireEnvironment,
  requireService,
  serviceIdInput,
} from "./support";
import { FourKeys, MeasurementWindow } from "../../dora/fourKeys";
import {
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  windowEndingAt,
} from "../../dora/window";

// DoraMetricsService satisfies this.
export type DeliveryMetrics = {
  forService(
    accountId: ObjectId,
    serviceId: ObjectId,
    environment: string,
    window: MeasurementWindow,
  ): Promise<FourKeys>;
};

export function getDeliveryMetricsTool(
  services: ServiceLookup,
  metrics: DeliveryMetrics,
  now: () => Date = () => new Date(),
) {
  return defineTool({
    name: "get_delivery_metrics",
    title: "Get delivery metrics",
    description:
      "Get the four DORA delivery metrics for one environment of a service over a recent window: deployment frequency per day, median lead time, change failure rate (0 to 1) and median time to restore. Durations are in milliseconds and are null when there is nothing to measure. `sample` says how many deployments each number rests on; with only a handful, treat the numbers as anecdote, not trend.",
    requiredScope: "builds:read",
    changes: false,
    input: {
      serviceId: serviceIdInput,
      environment: z
        .string()
        .describe("The environment to measure, e.g. prod."),
      days: z
        .number()
        .int()
        .min(1)
        .max(MAX_WINDOW_DAYS)
        .optional()
        .describe(
          `How many days back to measure. Default ${DEFAULT_WINDOW_DAYS}.`,
        ),
    },
    run: async (caller, input) => {
      const service = await requireService(services, caller, input.serviceId);
      requireEnvironment(service, input.environment);

      const days = input.days ?? DEFAULT_WINDOW_DAYS;
      const window = windowEndingAt(now(), days);
      const keys = await metrics.forService(
        caller.accountId,
        service._id,
        input.environment,
        window,
      );
      return {
        environment: input.environment,
        window: { ...window, days },
        ...keys,
      };
    },
  });
}
