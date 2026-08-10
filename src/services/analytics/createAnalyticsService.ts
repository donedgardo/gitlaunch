import { AnalyticsEventRepository } from "../../repositories/analyticsEventRepository";
import { AnalyticsService, ConsoleAnalytics, NoOpAnalytics } from "./analytics";
import { FanOutAnalytics } from "./fanOutAnalytics";
import { PostHogAnalytics, PostHogClientLike } from "./posthogAnalytics";
import { WarehouseAnalytics } from "./warehouseAnalytics";

export type AnalyticsConfig = {
  // Persist events into the Mongo warehouse (product analytics).
  warehouse: boolean;
  // Stream the same events to PostHog. Absent = PostHog is not configured.
  posthog?: PostHogClientLike;
  // When there is no real destination, log events to the console (dev).
  dev?: boolean;
  // Where the console sink writes. Injectable so tests don't read stdout.
  log?: (msg: string) => void;
};

/**
 * Assembles the analytics destinations an instance is configured for.
 *
 * Destinations compose: enabling PostHog does not replace the warehouse, and
 * neither is visible to the code that emits events — every call site depends
 * on `AnalyticsService` alone. A future destination is added here, and only
 * here.
 */
export function createAnalyticsService(
  repo: AnalyticsEventRepository,
  config: AnalyticsConfig,
): AnalyticsService {
  const sinks: AnalyticsService[] = [];
  if (config.warehouse) sinks.push(new WarehouseAnalytics(repo));
  if (config.posthog) sinks.push(new PostHogAnalytics(config.posthog));

  if (sinks.length === 0) {
    // No destination configured: echo events in dev so they are still
    // observable, and drop them otherwise.
    return config.dev ? new ConsoleAnalytics(config.log) : new NoOpAnalytics();
  }
  // Wrapping even a single sink keeps one failure mode: a destination that
  // throws is reported, never raised into the request that emitted the event.
  return new FanOutAnalytics(sinks);
}
