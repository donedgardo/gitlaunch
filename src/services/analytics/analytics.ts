// Optional per-event context. Carries the tenant and actor a persistent
// warehouse needs. Console/NoOp sinks ignore it, so existing call sites that
// omit it keep working unchanged.
export type AnalyticsContext = {
  accountId?: string;
  distinctId?: string;
  timestamp?: Date;
};

export interface AnalyticsService {
  identify(
    userId: string,
    traits: Record<string, any>,
    context?: AnalyticsContext,
  ): void;
  track(
    event: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void;
  navigation(
    destination: string,
    properties?: Record<string, any>,
    context?: AnalyticsContext,
  ): void;
  // Deliver anything still buffered. Optional: a sink that writes immediately
  // has nothing to drain. Callers await it on shutdown so the last events of a
  // deploy aren't lost with the process.
  flush?(): Promise<void>;
}

export class ConsoleAnalytics implements AnalyticsService {
  private log: (msg: string) => void;

  constructor(log?: (msg: string) => void) {
    this.log = log ?? console.info;
  }

  identify(userId: string, traits: Record<string, any>): void {
    this.log(`[analytics] identify: ${userId} ${JSON.stringify(traits)}`);
  }

  track(event: string, properties?: Record<string, any>): void {
    this.log(
      `[analytics] track: ${event}${properties ? " " + JSON.stringify(properties) : ""}`,
    );
  }

  navigation(destination: string, properties?: Record<string, any>): void {
    this.log(
      `[analytics] navigation: ${destination}${properties ? " " + JSON.stringify(properties) : ""}`,
    );
  }
}

export class NoOpAnalytics implements AnalyticsService {
  identify(): void {}
  track(): void {}
  navigation(): void {}
}
