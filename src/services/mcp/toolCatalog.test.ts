import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { McpCaller, ToolRefused, defineTool } from "./tool";
import { ToolCatalog } from "./toolCatalog";
import { ApiKeyScope } from "../../repositories/apiKeyRepository";

const caller = (scopes: ApiKeyScope[]): McpCaller => ({
  accountId: new ObjectId(),
  apiKeyId: new ObjectId(),
  name: "staging-agent",
  scopes,
});

// Two stand-in tools: one that reads, one that changes something.
const calls: Array<{ tool: string; input: unknown }> = [];
const look = defineTool({
  name: "look",
  title: "Look",
  description: "Reads.",
  requiredScope: "builds:read",
  changes: false,
  input: { limit: z.number().int().optional() },
  run: async (_caller, input) => {
    calls.push({ tool: "look", input });
    return { seen: true };
  },
});
const act = defineTool({
  name: "act",
  title: "Act",
  description: "Changes something.",
  requiredScope: "deployments:write",
  changes: true,
  input: { environment: z.string() },
  run: async (_caller, input) => {
    calls.push({ tool: "act", input });
    return { done: input.environment };
  },
});
const catalog = new ToolCatalog([look, act]);

describe("ToolCatalog", () => {
  describe("visibleTo", () => {
    it("should offer a key only the tools its scopes allow", () => {
      const visible = catalog.visibleTo(caller(["builds:read"]));

      expect(visible.map((t) => t.name)).toEqual(["look"]);
    });

    it("should offer every tool to a key that holds every scope needed", () => {
      const visible = catalog.visibleTo(
        caller(["builds:read", "deployments:write"]),
      );

      expect(visible.map((t) => t.name)).toEqual(["look", "act"]);
    });

    it("should offer nothing to a key with no matching scope", () => {
      expect(catalog.visibleTo(caller(["services:read"]))).toEqual([]);
    });
  });

  describe("call", () => {
    it("should run a tool the key is allowed to use and return its result", async () => {
      const result = await catalog.call(caller(["deployments:write"]), "act", {
        environment: "staging",
      });

      expect(result).toEqual({ done: "staging" });
    });

    it("should refuse a tool the key lacks the scope for, even when asked for by name", async () => {
      calls.length = 0;

      await expect(
        catalog.call(caller(["builds:read"]), "act", {
          environment: "prod",
        }),
      ).rejects.toThrow(ToolRefused);
      await expect(
        catalog.call(caller(["builds:read"]), "act", {
          environment: "prod",
        }),
      ).rejects.toThrow("Missing required scope: deployments:write");
      expect(calls).toEqual([]);
    });

    it("should refuse a tool that does not exist", async () => {
      await expect(
        catalog.call(caller(["builds:read"]), "launch_missiles", {}),
      ).rejects.toThrow(ToolRefused);
    });

    it("should refuse input that does not match what the tool takes, without running it", async () => {
      calls.length = 0;

      await expect(
        catalog.call(caller(["deployments:write"]), "act", {
          environment: 42,
        }),
      ).rejects.toThrow(ToolRefused);
      expect(calls).toEqual([]);
    });
  });

  describe("construction", () => {
    it("should refuse two tools with the same name, since a client could not tell them apart", () => {
      expect(() => new ToolCatalog([look, look])).toThrow(/look/);
    });
  });
});
