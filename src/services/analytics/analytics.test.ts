import { describe, it, expect, beforeEach } from "vitest";
import { AnalyticsService, ConsoleAnalytics, NoOpAnalytics } from "./analytics";

describe("AnalyticsService", () => {
  describe("ConsoleAnalytics", () => {
    let analytics: AnalyticsService;
    let logs: string[];

    beforeEach(() => {
      logs = [];
      analytics = new ConsoleAnalytics((msg: string) => logs.push(msg));
    });

    it("should log identify calls with userId and traits", () => {
      analytics.identify("user-123", { plan: "pro", name: "Ed" });

      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain("user-123");
      expect(logs[0]).toContain("pro");
    });

    it("should log track calls with event name and properties", () => {
      analytics.track("service_created", { serviceName: "my-api" });

      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain("service_created");
      expect(logs[0]).toContain("my-api");
    });

    it("should log track calls without properties", () => {
      analytics.track("onboarding_started");

      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain("onboarding_started");
    });

    it("should log navigation calls with destination and properties", () => {
      analytics.navigation("dashboard", { serviceName: "my-api" });

      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain("dashboard");
      expect(logs[0]).toContain("my-api");
    });

    it("should log navigation calls without properties", () => {
      analytics.navigation("settings");

      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain("settings");
    });
  });

  describe("NoOpAnalytics", () => {
    it("should not throw on any call", () => {
      const analytics: AnalyticsService = new NoOpAnalytics();

      expect(() =>
        analytics.identify("user-1", { plan: "free" }),
      ).not.toThrow();
      expect(() => analytics.track("build_reported")).not.toThrow();
      expect(() => analytics.navigation("dashboard")).not.toThrow();
    });
  });
});
