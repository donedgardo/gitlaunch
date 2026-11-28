import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gitlaunchTools, MCP_SERVER_VERSION } from "../gitlaunchTools";
import { describeTool } from "../toolCatalog";
import { aCaller, emptyToolDeps } from "../fakes";
import { scopesFor } from "../../apiKey/keyAccess";

/**
 * The agent-facing contract: which tools exist, what scope each needs,
 * whether it changes anything, and the exact input it takes.
 *
 * An agent, a saved prompt or a customer's automation is written against
 * these names and inputs, and nothing fails on their side until the day a
 * call is refused. So a change here has to be a decision, not a side effect
 * of editing a tool: this test fails until the golden file is updated on
 * purpose.
 *
 * Descriptions are left out. Rewording one changes how well a model chooses
 * the tool, not whether an existing call still works.
 *
 * To accept an intended change: bump MCP_SERVER_VERSION if an existing agent
 * would notice, then run `UPDATE_MCP_CONTRACT=1 yarn test toolContract`.
 */
const GOLDEN = path.join(__dirname, "tools.golden.json");

const catalog = gitlaunchTools(emptyToolDeps());

const current = {
  version: MCP_SERVER_VERSION,
  tools: catalog.visibleTo(aCaller(scopesFor("full"))).map((tool) => {
    const { name, inputSchema } = describeTool(tool);
    return {
      name,
      requiredScope: tool.requiredScope,
      changes: tool.changes,
      inputSchema,
    };
  }),
};

describe("MCP tool contract", () => {
  it("should match the golden contract", () => {
    if (process.env.UPDATE_MCP_CONTRACT) {
      writeFileSync(GOLDEN, JSON.stringify(current, null, 2) + "\n");
    }
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));

    expect(current).toEqual(golden);
  });

  it("should give every input field a description, since that is all a model has to go on", () => {
    for (const tool of current.tools) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<
        string,
        { description?: string }
      >;
      for (const [field, schema] of Object.entries(properties)) {
        expect(
          schema.description,
          `${tool.name}.${field} has no description`,
        ).toBeTruthy();
      }
    }
  });

  it("should name tools so that reading and changing are told apart at a glance", () => {
    for (const tool of current.tools) {
      const reads = /^(list|get)_/.test(tool.name);
      expect(reads, `${tool.name} is misnamed for what it does`).toBe(
        !tool.changes,
      );
    }
  });
});
