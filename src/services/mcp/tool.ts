import { ObjectId } from "mongodb";
import { z } from "zod";
import { ApiKeyScope } from "../../repositories/apiKeyRepository";

/**
 * Who is calling a tool: the API key the agent connected with.
 *
 * This is everything a tool may know about its caller. There is no session
 * and no user — the key is the identity, its scopes say what it may do and
 * its environment list says where.
 *
 * `client` is what the connecting program calls itself. It is a label for the
 * history, never something to authorise on.
 */
export type McpCaller = {
  accountId: ObjectId;
  apiKeyId: ObjectId;
  name?: string;
  createdByUserId?: ObjectId;
  scopes: readonly ApiKeyScope[];
  allowedEnvironments?: readonly string[] | null;
  client?: string;
};

/**
 * One thing an agent can do through the MCP server.
 *
 * A tool is a use case and nothing else: it names the scope it needs, says
 * whether it changes anything, describes its input, and runs. It knows nothing
 * of HTTP or of the MCP protocol — the route adapts it to both — so the same
 * rules hold however it is reached.
 *
 * `description` is written for the model that will choose the tool, so it
 * says when to use it and what comes back, not how it is built.
 */
export type McpTool<Shape extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  title: string;
  description: string;
  requiredScope: ApiKeyScope;
  // False for a tool that only reads. Clients use this to decide what needs a
  // person's go-ahead.
  changes: boolean;
  input: Shape;
  run(caller: McpCaller, input: z.infer<z.ZodObject<Shape>>): Promise<unknown>;
};

// Lets a tool's `run` see its own input type without spelling it out twice.
export function defineTool<Shape extends z.ZodRawShape>(
  tool: McpTool<Shape>,
): McpTool<Shape> {
  return tool;
}

/**
 * A call that was turned down for a reason the caller should be told: a
 * missing scope, an environment outside the key's list, input that does not
 * fit, something that does not exist. The message is shown to the agent, so it
 * must never carry anything internal. Any other error is a fault, and is
 * reported to the agent only as one.
 */
export class ToolRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRefused";
  }
}
