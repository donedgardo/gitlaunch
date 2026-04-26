export interface AnalyticsService {
  identify(userId: string, traits: Record<string, any>): void;
  track(event: string, properties?: Record<string, any>): void;
  navigation(destination: string, properties?: Record<string, any>): void;
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
