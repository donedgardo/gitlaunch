import { describe, it, expect } from "vitest";
import { gitlaunchTools } from "./gitlaunchTools";
import { FakeWorkspace, aCaller } from "./fakes";
import { scopesFor } from "../apiKey/keyAccess";

// The assembled catalog, over empty stores: this is about which tools exist
// and who is offered them, not what they return.
const catalog = gitlaunchTools({
  services: Object.assign(new FakeWorkspace(), {
    findByAccountId: async () => [],
  }),
  builds: new FakeWorkspace(),
  flags: { listFlags: async () => [], getFlag: async () => null },
  metrics: {
    forService: async () => {
      throw new Error("not measured in this test");
    },
  },
  flagHistory: { listByService: async () => [] },
});

const offeredTo = (scopes: Parameters<typeof aCaller>[0]) =>
  catalog.visibleTo(aCaller(scopes)).map((t) => t.name);

describe("gitlaunchTools", () => {
  it("should offer a read-only key every tool that only reads", () => {
    expect(offeredTo(scopesFor("read"))).toEqual([
      "list_services",
      "get_release_board",
      "get_build",
      "get_activity",
      "get_delivery_metrics",
      "list_flags",
      "get_flag",
    ]);
  });

  it("should offer a read-only key nothing that changes anything", () => {
    const tools = catalog.visibleTo(aCaller(scopesFor("read")));

    expect(tools.filter((t) => t.changes)).toEqual([]);
  });

  it("should not offer flag tools to a key that cannot read flags", () => {
    expect(offeredTo(["services:read", "builds:read"])).toEqual([
      "list_services",
      "get_release_board",
      "get_build",
      "get_activity",
      "get_delivery_metrics",
    ]);
  });

  it("should describe every tool well enough for a model to choose it", () => {
    for (const tool of catalog.visibleTo(aCaller(scopesFor("full")))) {
      expect(tool.name).toMatch(/^[a-z][a-z_]*$/);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(60);
    }
  });
});
