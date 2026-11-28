import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import {
  ApiKeyContext,
  createApiKeyAuthMiddleware,
} from "../../middleware/apiKeyAuth";
import { McpAccess } from "../../../services/mcp/mcpGate";
import { McpCaller, ToolRefused } from "../../../services/mcp/tool";
import { ToolCatalog, describeTool } from "../../../services/mcp/toolCatalog";

export type McpRoutesDeps = {
  apiKeyService: ApiKeyService;
  catalog: ToolCatalog;
  // Whether the MCP server is switched on for an account.
  access: McpAccess;
  // Reported to clients as the server's version.
  version: string;
};

// Told to the connecting model once, before it sees any tool.
const INSTRUCTIONS =
  "GitLaunch tracks which build of each service is live in each environment and lets you release builds and switch feature flags. " +
  "Call list_services first: every other tool takes a service id from it. " +
  "You are acting with an API key. Its scopes decide which tools you are offered, and it may be limited to certain environments; a refusal names what is missing, and retrying will not change it. " +
  "Everything you change is recorded against this key.";

const NO_STREAM = {
  jsonrpc: "2.0",
  error: {
    code: -32000,
    message:
      "Method not allowed. This server answers each POST directly and keeps no stream or session.",
  },
  id: null,
};

const CLIENT_LABEL_MAX = 40;

/**
 * What the connecting program calls itself, from its User-Agent: the product
 * name before the first "/" or space ("claude-code/2.1.0 (cli)" gives
 * "claude-code"). The caller chooses this, so it is stripped to plain
 * characters and capped before it is stored on history or shown to anyone —
 * and it is only ever a label. The key is the identity.
 */
export function clientLabel(userAgent: string | undefined): string | undefined {
  const product = (userAgent ?? "").split(/[/\s]/)[0];
  const label = product
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, CLIENT_LABEL_MAX);
  return label || undefined;
}

function callerFrom(key: ApiKeyContext, userAgent?: string): McpCaller {
  const client = clientLabel(userAgent);
  return {
    ...(client ? { client } : {}),
    accountId: key.accountId,
    apiKeyId: key.apiKeyId,
    name: key.name,
    createdByUserId: key.createdByUserId,
    scopes: key.scopes,
    allowedEnvironments: key.allowedEnvironments,
  };
}

const asText = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const asRefusal = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

/**
 * The MCP server: `POST /mcp`, speaking Streamable HTTP.
 *
 * This file is only the adapter. It authenticates the same API keys the REST
 * API takes, turns the key into a caller, and hands tool listing and tool
 * calls to the catalog — which is where scope is decided. Nothing here knows
 * what any tool does.
 *
 * Stateless: every request builds a server for that one caller and throws it
 * away. There is no session to pin to an instance or lose on a deploy, and a
 * key revoked a second ago is refused on the very next call.
 */
export function registerMcpRoutes(
  app: FastifyInstance,
  deps: McpRoutesDeps,
): void {
  const { apiKeyService, catalog, access, version } = deps;

  const serverFor = (caller: McpCaller, request: FastifyRequest): Server => {
    const server = new Server(
      { name: "gitlaunch", version },
      { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: catalog.visibleTo(caller).map((tool) => {
        const { name, title, description, inputSchema } = describeTool(tool);
        return {
          name,
          title,
          description,
          inputSchema,
          annotations: {
            title,
            readOnlyHint: !tool.changes,
            // destructiveHint is left at the protocol's default (true for a
            // tool that changes things): a deploy replaces what is running,
            // and a client is right to ask a person before it does.
            //
            // GitLaunch acts only on the account's own services.
            openWorldHint: false,
          },
        };
      }),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      const { name, arguments: input } = call.params;
      try {
        return asText(await catalog.call(caller, name, input));
      } catch (error) {
        if (error instanceof ToolRefused) {
          return asRefusal(error.message);
        }
        // A fault, not a refusal. The detail may carry a CI provider's
        // response or a URL the customer chose, so it goes to the log and the
        // agent is told only that it failed.
        request.log.error({ err: error, tool: name }, "MCP tool failed");
        return asRefusal(`${name} failed. Nothing more is known; try again.`);
      }
    });

    return server;
  };

  app.register(async (mcp) => {
    mcp.addHook("preHandler", createApiKeyAuthMiddleware(apiKeyService));
    mcp.addHook("preHandler", async (request, reply) => {
      const key = request.apiKey;
      if (!key) return;
      // A browser-visible key reaching a server that can release software
      // means something is wrong, whatever scopes it carries.
      if (key.kind === "publishable") {
        return reply.status(403).send({
          error:
            "The MCP server requires a secret key. Publishable keys may only evaluate flags and record conversions.",
        });
      }
      // Indistinguishable from the route not existing, so an account it is
      // not switched on for learns nothing about it.
      if (!(await access.allows(key.accountId))) {
        return reply.status(404).send({ error: "Not found" });
      }
    });

    mcp.post("/mcp", async (request: FastifyRequest, reply: FastifyReply) => {
      const caller = callerFrom(request.apiKey!, request.headers["user-agent"]);
      const server = serverFor(caller, request);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      // From here the transport writes the response itself.
      reply.hijack();
      reply.raw.on("close", () => {
        void transport.close();
        void server.close();
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
        request.log.error({ err: error }, "MCP request failed");
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { "content-type": "application/json" });
          reply.raw.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null,
            }),
          );
        }
      }
    });

    const noStream = async (_request: FastifyRequest, reply: FastifyReply) =>
      reply.status(405).header("Allow", "POST").send(NO_STREAM);
    mcp.get("/mcp", noStream);
    mcp.delete("/mcp", noStream);
  });
}
