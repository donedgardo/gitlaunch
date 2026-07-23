import { ObjectId } from "mongodb";
import {
  AnalyticsEventRepository,
  AnalyticsEventType,
} from "../../repositories/analyticsEventRepository";
import { AnalyticsContext, AnalyticsService } from "./analytics";

type ErrorReporter = (error: unknown) => void;

/**
 * Persists analytics events into the Mongo warehouse.
 *
 * Implements the synchronous, fire-and-forget AnalyticsService contract: each
 * method starts the insert without awaiting it and swallows failures, so
 * analytics can never block or break the request path that emitted the event.
 */
export class WarehouseAnalytics implements AnalyticsService {
  // Stable event name for identify rows (PostHog-style). The identified user is
  // carried in distinctId, not in `event`.
  static readonly IDENTIFY_EVENT = "$identify";

  // In-flight inserts, so callers (graceful shutdown, tests) can drain them.
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly repo: AnalyticsEventRepository,
    private readonly onError: ErrorReporter = (e) =>
      console.error("[analytics] failed to persist event", e),
  ) {}

  /** Wait for all in-flight writes to complete (e.g. on shutdown). */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  identify(
    userId: string,
    traits?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    // For identify the actor IS the subject, regardless of context.distinctId.
    // The user lives in distinctId; `event` stays a stable, readable name so
    // identify rows don't pollute event-name aggregations (topEvents) with one
    // opaque userId per row.
    this.persist("identify", WarehouseAnalytics.IDENTIFY_EVENT, traits, {
      ...context,
      distinctId: userId,
    });
  }

  track(
    event: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    this.persist("track", event, properties, context);
  }

  navigation(
    destination: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    this.persist("navigation", destination, properties, context);
  }

  private persist(
    type: AnalyticsEventType,
    event: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    const write = this.repo
      .insert({
        type,
        event,
        properties: properties ?? {},
        accountId: this.toObjectId(context?.accountId),
        distinctId: context?.distinctId,
        timestamp: context?.timestamp,
      })
      .catch(this.onError)
      .finally(() => this.pending.delete(write));
    this.pending.add(write);
  }

  private toObjectId(id?: string): ObjectId | undefined {
    if (!id || !ObjectId.isValid(id)) return undefined;
    return new ObjectId(id);
  }
}
