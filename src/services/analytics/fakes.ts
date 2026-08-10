import { AnalyticsContext, AnalyticsService } from "./analytics";
import {
  PostHogCaptureMessage,
  PostHogClientLike,
  PostHogIdentifyMessage,
} from "./posthogAnalytics";

/**
 * In-memory stand-in for the PostHog SDK. Records what would have been sent so
 * tests can assert on the delivered payload without a network call.
 */
export class FakePostHogClient implements PostHogClientLike {
  readonly captured: PostHogCaptureMessage[] = [];
  readonly identified: PostHogIdentifyMessage[] = [];
  flushes = 0;
  shutdowns = 0;

  // When set, every call throws it — models an SDK that is misconfigured or
  // has lost its connection.
  failWith?: Error;

  capture(message: PostHogCaptureMessage): void {
    if (this.failWith) throw this.failWith;
    this.captured.push(message);
  }

  identify(message: PostHogIdentifyMessage): void {
    if (this.failWith) throw this.failWith;
    this.identified.push(message);
  }

  async flush(): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.flushes++;
  }

  async shutdown(): Promise<void> {
    this.shutdowns++;
  }
}

/** Analytics sink that remembers every call, for composition tests. */
export class RecordingAnalytics implements AnalyticsService {
  readonly identifies: Array<{
    userId: string;
    traits: Record<string, any>;
    context?: AnalyticsContext;
  }> = [];
  readonly tracked: Array<{
    event: string;
    properties?: Record<string, any>;
    context?: AnalyticsContext;
  }> = [];
  readonly navigations: Array<{
    destination: string;
    properties?: Record<string, any>;
    context?: AnalyticsContext;
  }> = [];

  // When set, every method throws it — models one sink of several going bad.
  failWith?: Error;

  identify(
    userId: string,
    traits: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    if (this.failWith) throw this.failWith;
    this.identifies.push({ userId, traits, context });
  }

  track(
    event: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    if (this.failWith) throw this.failWith;
    this.tracked.push({ event, properties, context });
  }

  navigation(
    destination: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    if (this.failWith) throw this.failWith;
    this.navigations.push({ destination, properties, context });
  }
}
