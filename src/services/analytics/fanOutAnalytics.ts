import { AnalyticsContext, AnalyticsService } from "./analytics";

type ErrorReporter = (error: unknown) => void;

// A sink that buffers its writes and can be drained. Optional: plain sinks
// (console, no-op) have nothing to drain.
type Drainable = { flush(): Promise<void> };

function isDrainable(
  sink: AnalyticsService,
): sink is AnalyticsService & Drainable {
  return typeof (sink as Partial<Drainable>).flush === "function";
}

/**
 * One analytics port, several destinations.
 *
 * Sending the same event to the warehouse and to a product-analytics vendor is
 * a composition concern, not a call-site concern: emitters keep depending on
 * `AnalyticsService` alone, and a new destination is added here rather than by
 * editing every route and service that tracks something.
 *
 * A failing sink is isolated — the others still receive the event, and the
 * caller never sees the error.
 */
export class FanOutAnalytics implements AnalyticsService {
  constructor(
    private readonly sinks: AnalyticsService[],
    private readonly onError: ErrorReporter = (e) =>
      console.error("[analytics] sink failed", e),
  ) {}

  identify(
    userId: string,
    traits: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    this.each((sink) => sink.identify(userId, traits, context));
  }

  track(
    event: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    this.each((sink) => sink.track(event, properties, context));
  }

  navigation(
    destination: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void {
    this.each((sink) => sink.navigation(destination, properties, context));
  }

  /** Drain every sink that buffers, so shutdown loses nothing. */
  async flush(): Promise<void> {
    await Promise.allSettled(
      this.sinks.filter(isDrainable).map((sink) => sink.flush()),
    );
  }

  private each(deliver: (sink: AnalyticsService) => void): void {
    for (const sink of this.sinks) {
      try {
        deliver(sink);
      } catch (err) {
        this.onError(err);
      }
    }
  }
}
