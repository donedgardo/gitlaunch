import { describe, it, expect } from "vitest";
import {
  scopesFor,
  parseAccessLevel,
  describeAccess,
  mayActOnEnvironment,
  isEnvironmentLimited,
  parseEnvironmentList,
} from "./keyAccess";

describe("keyAccess", () => {
  describe("scopesFor", () => {
    it("should grant every server-side scope when access is full", () => {
      expect(scopesFor("full").sort()).toEqual(
        [
          "builds:read",
          "builds:write",
          "deployments:write",
          "flags:read",
          "flags:write",
          "services:read",
          "services:write",
        ].sort(),
      );
    });

    it("should let a release key deploy and switch flags but not reconfigure services or report builds", () => {
      const scopes = scopesFor("release");

      expect(scopes).toContain("deployments:write");
      expect(scopes).toContain("flags:write");
      expect(scopes).toContain("builds:read");
      expect(scopes).not.toContain("services:write");
      expect(scopes).not.toContain("builds:write");
    });

    it("should grant no write scope when access is read", () => {
      const scopes = scopesFor("read");

      expect(scopes.length).toBeGreaterThan(0);
      expect(scopes.every((s) => s.endsWith(":read"))).toBe(true);
    });
  });

  describe("parseAccessLevel", () => {
    it("should default to full when nothing was chosen, as keys always were", () => {
      expect(parseAccessLevel(undefined)).toBe("full");
      expect(parseAccessLevel("")).toBe("full");
    });

    it("should accept each known level", () => {
      expect(parseAccessLevel("read")).toBe("read");
      expect(parseAccessLevel("release")).toBe("release");
      expect(parseAccessLevel("full")).toBe("full");
    });

    it("should refuse an unknown level rather than guess", () => {
      expect(parseAccessLevel("admin")).toBeNull();
    });
  });

  describe("describeAccess", () => {
    it("should name the level a key's scopes correspond to", () => {
      expect(describeAccess(scopesFor("read"))).toBe("Read-only");
      expect(describeAccess(scopesFor("release"))).toBe("Release");
      expect(describeAccess(scopesFor("full"))).toBe("Full access");
    });

    it("should call a hand-built scope set custom", () => {
      expect(describeAccess(["builds:write"])).toBe("Custom");
    });
  });

  describe("mayActOnEnvironment", () => {
    it("should allow any environment when the key has no limit", () => {
      expect(mayActOnEnvironment({}, "prod")).toBe(true);
      expect(mayActOnEnvironment({ allowedEnvironments: null }, "prod")).toBe(
        true,
      );
      expect(mayActOnEnvironment({ allowedEnvironments: [] }, "prod")).toBe(
        true,
      );
    });

    it("should allow only the listed environments when the key is limited", () => {
      const key = { allowedEnvironments: ["staging", "qa"] };

      expect(mayActOnEnvironment(key, "staging")).toBe(true);
      expect(mayActOnEnvironment(key, "qa")).toBe(true);
      expect(mayActOnEnvironment(key, "prod")).toBe(false);
    });

    it("should treat environment names as exact, so a lookalike is not let through", () => {
      const key = { allowedEnvironments: ["staging"] };

      expect(mayActOnEnvironment(key, "Staging")).toBe(false);
      expect(mayActOnEnvironment(key, "staging2")).toBe(false);
    });
  });

  describe("isEnvironmentLimited", () => {
    it("should be true only when the key lists environments", () => {
      expect(isEnvironmentLimited({ allowedEnvironments: ["staging"] })).toBe(
        true,
      );
      expect(isEnvironmentLimited({ allowedEnvironments: [] })).toBe(false);
      expect(isEnvironmentLimited({})).toBe(false);
    });
  });

  describe("parseEnvironmentList", () => {
    it("should read a comma-separated list, trimming and dropping blanks and repeats", () => {
      expect(parseEnvironmentList(" staging, qa ,,staging")).toEqual([
        "staging",
        "qa",
      ]);
    });

    it("should read repeated form fields", () => {
      expect(parseEnvironmentList(["staging", "qa"])).toEqual([
        "staging",
        "qa",
      ]);
    });

    it("should be empty when nothing was given", () => {
      expect(parseEnvironmentList(undefined)).toEqual([]);
      expect(parseEnvironmentList("")).toEqual([]);
    });
  });
});
