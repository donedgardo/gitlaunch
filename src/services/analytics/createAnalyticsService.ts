import { AnalyticsEventRepository } from "../../repositories/analyticsEventRepository";
import { AnalyticsService, ConsoleAnalytics, NoOpAnalytics } from "./analytics";
import { WarehouseAnalytics } from "./warehouseAnalytics";

export type AnalyticsConfig = {
  // Persist events into the Mongo warehouse (product analytics).
  warehouse: boolean;
  // When the warehouse is off, log events to the console (useful in dev).
  dev?: boolean;
};

export function createAnalyticsService(
  repo: AnalyticsEventRepository,
  config: AnalyticsConfig,
): AnalyticsService {
  if (config.warehouse) {
    return new WarehouseAnalytics(repo);
  }
  return config.dev ? new ConsoleAnalytics() : new NoOpAnalytics();
}
