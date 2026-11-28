import { z } from "zod";
import { McpCaller, McpTool, ToolRefused } from "./tool";

// A catalog holds tools of every input shape; each is checked against its own
// shape when it is called.
type AnyTool = McpTool<any>;

export type ToolDescription = {
  name: string;
  title: string;
  description: string;
  requiredScope: AnyTool["requiredScope"];
  changes: boolean;
  inputSchema: { type: "object"; [key: string]: unknown };
};

/** A tool as a client, the docs and the contract test all see it. */
export function describeTool(tool: AnyTool): ToolDescription {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    requiredScope: tool.requiredScope,
    changes: tool.changes,
    inputSchema: z.toJSONSchema(
      z.object(tool.input),
    ) as ToolDescription["inputSchema"],
  };
}

/**
 * Every tool the MCP server has, and the rule for who may use which.
 *
 * Scope is enforced twice on purpose. `visibleTo` keeps an agent from being
 * offered a tool it cannot use; `call` refuses again, because a tool can be
 * asked for by name whether or not it was offered.
 */
export class ToolCatalog {
  private readonly tools: readonly AnyTool[];

  constructor(tools: readonly AnyTool[]) {
    const seen = new Set<string>();
    for (const tool of tools) {
      if (seen.has(tool.name)) {
        throw new Error(`Two MCP tools are both named "${tool.name}"`);
      }
      seen.add(tool.name);
    }
    this.tools = tools;
  }

  /** Every tool there is, whoever is asking. For documentation. */
  describeAll(): ToolDescription[] {
    return this.tools.map(describeTool);
  }

  visibleTo(caller: McpCaller): AnyTool[] {
    return this.tools.filter((t) => caller.scopes.includes(t.requiredScope));
  }

  async call(
    caller: McpCaller,
    name: string,
    rawInput: unknown,
  ): Promise<unknown> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) {
      throw new ToolRefused(`Unknown tool: ${name}`);
    }
    if (!caller.scopes.includes(tool.requiredScope)) {
      throw new ToolRefused(`Missing required scope: ${tool.requiredScope}`);
    }

    const parsed = z.object(tool.input).safeParse(rawInput ?? {});
    if (!parsed.success) {
      const problems = parsed.error.issues
        .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
        .join("; ");
      throw new ToolRefused(`Invalid input for ${name}: ${problems}`);
    }

    return tool.run(caller, parsed.data);
  }
}
