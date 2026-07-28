import { describe, it, expect } from "vitest";
import { InternalTraffic } from "./internalTraffic";

describe("InternalTraffic", () => {
  describe("isInternalEmail", () => {
    it("should treat a configured address as internal", () => {
      const rules = InternalTraffic.fromEnv({
        ANALYTICS_INTERNAL_EMAILS: "founder@gitlaunch.dev",
      });

      expect(rules.isInternalEmail("founder@gitlaunch.dev")).toBe(true);
    });

    it("should treat every address at a configured domain as internal", () => {
      const rules = InternalTraffic.fromEnv({
        ANALYTICS_INTERNAL_EMAILS: "@gitlaunch.dev",
      });

      expect(rules.isInternalEmail("anyone@gitlaunch.dev")).toBe(true);
      expect(rules.isInternalEmail("someone-else@gitlaunch.dev")).toBe(true);
    });

    it("should ignore casing and surrounding whitespace", () => {
      const rules = InternalTraffic.fromEnv({
        ANALYTICS_INTERNAL_EMAILS: " Founder@GitLaunch.dev , @Example.COM ",
      });

      expect(rules.isInternalEmail("FOUNDER@gitlaunch.dev")).toBe(true);
      expect(rules.isInternalEmail("  someone@EXAMPLE.com  ")).toBe(true);
    });

    it("should treat an unlisted address as external", () => {
      const rules = InternalTraffic.fromEnv({
        ANALYTICS_INTERNAL_EMAILS: "founder@gitlaunch.dev,@example.com",
      });

      expect(rules.isInternalEmail("real.person@gmail.com")).toBe(false);
    });

    it("should not confuse a domain suffix with the configured domain", () => {
      const rules = InternalTraffic.fromEnv({
        ANALYTICS_INTERNAL_EMAILS: "@example.com",
      });

      expect(rules.isInternalEmail("someone@notexample.com")).toBe(false);
    });

    it("should treat nothing as internal when unconfigured", () => {
      const rules = InternalTraffic.fromEnv({});

      expect(rules.isInternalEmail("founder@gitlaunch.dev")).toBe(false);
      expect(rules.configured).toBe(false);
    });
  });

  describe("excludeMatch", () => {
    it("should filter out events explicitly marked internal", () => {
      const rules = InternalTraffic.fromEnv({
        ANALYTICS_INTERNAL_EMAILS: "founder@gitlaunch.dev",
      });

      expect(JSON.stringify(rules.excludeMatch())).toContain(
        "properties.internal",
      );
    });

    it("should filter out configured actor ids", () => {
      const rules = InternalTraffic.fromEnv({
        ANALYTICS_INTERNAL_ACTORS: "visitor-abc, 6a68137ad9bee0edf44fa114",
      });

      const match = JSON.stringify(rules.excludeMatch());
      expect(match).toContain("visitor-abc");
      expect(match).toContain("6a68137ad9bee0edf44fa114");
    });

    it("should be a no-op when nothing is configured", () => {
      const rules = InternalTraffic.fromEnv({});

      expect(rules.excludeMatch()).toEqual({});
    });
  });
});
