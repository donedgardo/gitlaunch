import { AnalyticsContext, AnalyticsService } from "./analytics";

/**
 * The slice of a PostHog client this sink uses.
 *
 * We own this interface; the vendor SDK conforms to it. That keeps the
 * dependency pointing inward — nothing outside `createPostHogClient` imports
 * `posthog-node`, and the sink is testable without a network or an SDK.
 */
export type PostHogCaptureMessage = {
  distinctId: string;
  event: string;
  properties?: Record<string, any>;
  groups?: Record<string, string>;
  timestamp?: Date;
};

export type PostHogIdentifyMessage = {
  distinctId: string;
  properties?: Record<string, any>;
};

export interface PostHogClientLike {
  capture(message: PostHogCaptureMessage): void;
  identify(message: PostHogIdentifyMessage): void;
  captureException?(
    error: unknown,
    distinctId?: string,
    additionalProperties?: Record<string, any>,
  ): void;
  flush?(): Promise<void>;
  shutdown?(): Promise<void>;
}

type ErrorReporter = (error: unknown) => void;

/**
 * Who an event belongs to when we genuinely do not know. PostHog requires a
 * distinct id on every message, while the warehouse tolerates none — so
 * untenanted signals (a landing-page hit before any cookie) land here rather
 * than being dropped. They are deliberately one bucket, not one person.
 */
export const ANONYMOUS_DISTINCT_ID = "anonymous";

// PostHog's group type for a GitLaunch tenant, so product usage can be read
// per customer rather than only per person.
const ACCOUNT_GROUP = "account";

/**
 * Streams product events into PostHog.
 *
 * One `AnalyticsService` implementation among several: call sites keep talking
 * to the port, so adding this sink changed no route, service, or test that
 * emits an event. Like the warehouse sink it is fire-and-forget — a PostHog
 * outage must never surface on the request path that emitted the event.
 */
export class PostHogAnalytics implements AnalyticsService {
  constructor(
    private readonly client: PostHogClientLike,
    private readonly onError: ErrorReporter = (e) =>
      console.error("[analytics] posthog delivery failed", e),
  ) {}

  identify(
    userId: string,
    traits?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    // The identified person is the subject of the call, never the context
    // actor — same rule the warehouse sink applies.
    this.guard(() =>
      this.client.identify({
        distinctId: userId,
        properties: { ...traits, ...this.accountProperties(context) },
      }),
    );
  }

  track(
    event: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    this.send(event, properties, context);
  }

  navigation(
    destination: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    // PostHog has no separate navigation channel, so the destination becomes
    // the event name and the kind becomes a property — reachable as a filter
    // rather than silently blended into deliberate actions.
    this.send(destination, { ...properties, type: "navigation" }, context);
  }

  captureException(
    error: unknown,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    this.guard(() =>
      this.client.captureException?.(error, context?.distinctId, {
        ...properties,
        ...this.accountProperties(context),
      }),
    );
  }

  /** Deliver anything the client is still holding (e.g. on shutdown). */
  async flush(): Promise<void> {
    try {
      await this.client.flush?.();
    } catch (err) {
      this.onError(err);
    }
  }

  private send(
    event: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    const accountId = context?.accountId;
    this.guard(() =>
      this.client.capture({
        distinctId: context?.distinctId || ANONYMOUS_DISTINCT_ID,
        event,
        properties: { ...properties, ...this.accountProperties(context) },
        groups: accountId ? { [ACCOUNT_GROUP]: accountId } : undefined,
        // Backfilled events keep the time they happened, not the time we sent
        // them, so a historical import doesn't pile up on today.
        timestamp: context?.timestamp,
      }),
    );
  }

  private accountProperties(
    context?: AnalyticsContext,
  ): Record<string, string> {
    return context?.accountId ? { accountId: context.accountId } : {};
  }

  private guard(send: () => void): void {
    try {
      send();
    } catch (err) {
      this.onError(err);
    }
  }
}
