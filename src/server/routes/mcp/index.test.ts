import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AccountRepository } from "../../../repositories/accountRepository";
import {
  ApiKeyRepository,
  ApiKeyScope,
} from "../../../repositories/apiKeyRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import { ToolCatalog } from "../../../services/mcp/toolCatalog";
import { listServicesTool } from "../../../services/mcp/tools/listServices";
import { registerMcpRoutes } from "./index";

// Drives the endpoint the way an agent does: a real MCP client over HTTP,
// holding a real API key.
describe("MCP endpoint", () => {
  let mongoServer: MongoMemoryServer;
  let mongo: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let baseUrl: string;
  let accountRepo: AccountRepository;
  let serviceRepo: ServiceRepository;
  let apiKeyService: ApiKeyService;
  let accountId: ObjectId;
  let open = true;
  const clients: Client[] = [];

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    mongo = new MongoClient(mongoServer.getUri());
    await mongo.connect();
    db = mongo.db("test");
  });

  afterAll(async () => {
    await mongo.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("apiKeys").deleteMany({});
    await db.collection("services").deleteMany({});
    accountRepo = new AccountRepository(db);
    serviceRepo = new ServiceRepository(db);
    apiKeyService = new ApiKeyService(new ApiKeyRepository(db), accountRepo);
    open = true;

    const account = await accountRepo.create({ name: "Acme", slug: "acme" });
    accountId = account._id;
    await serviceRepo.create({ accountId, name: "web-app" });

    app = Fastify();
    registerMcpRoutes(app, {
      apiKeyService,
      catalog: new ToolCatalog([listServicesTool(serviceRepo)]),
      access: { allows: async () => open },
      version: "9.9.9",
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
    await app.close();
  });

  async function mintKey(
    scopes: ApiKeyScope[],
    forAccount: ObjectId = accountId,
  ): Promise<string> {
    const minted = await apiKeyService.generate({
      accountId: forAccount,
      createdByUserId: new ObjectId(),
      name: "staging-agent",
      scopes,
    });
    return minted.key;
  }

  async function connect(key: string): Promise<Client> {
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${key}` } },
      }),
    );
    return client;
  }

  const initialize = (headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "raw", version: "0" },
        },
      }),
    });

  const textOf = (result: unknown) =>
    (result as { content: { type: string; text: string }[] }).content[0].text;

  describe("connecting", () => {
    it("should introduce itself as GitLaunch at the running version", async () => {
      const client = await connect(await mintKey(["services:read"]));

      expect(client.getServerVersion()).toMatchObject({
        name: "gitlaunch",
        version: "9.9.9",
      });
    });

    it("should refuse a connection that carries no API key", async () => {
      const response = await initialize();

      expect(response.status).toBe(401);
    });

    it("should refuse a key that is not valid", async () => {
      const response = await initialize({
        authorization: "Bearer sk_acme_notarealkeynotarealkeynotarealkey",
      });

      expect(response.status).toBe(401);
    });

    it("should refuse a publishable key, which is meant for browsers", async () => {
      const service = await serviceRepo.create({ accountId, name: "site" });
      const minted = await apiKeyService.generate({
        accountId,
        createdByUserId: new ObjectId(),
        name: "Web app",
        scopes: ["flags:evaluate"],
        kind: "publishable",
        serviceId: service._id,
        environment: "prod",
        allowedOrigins: ["https://app.example.com"],
      });

      const response = await initialize({
        authorization: `Bearer ${minted.key}`,
      });

      expect(response.status).toBe(403);
    });

    it("should not exist for an account the MCP server is not switched on for", async () => {
      open = false;

      const response = await initialize({
        authorization: `Bearer ${await mintKey(["services:read"])}`,
      });

      expect(response.status).toBe(404);
    });

    it("should say plainly that it has no stream to open", async () => {
      const response = await fetch(`${baseUrl}/mcp`, {
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${await mintKey(["services:read"])}`,
        },
      });

      expect(response.status).toBe(405);
    });
  });

  describe("tools", () => {
    it("should offer a key the tools its scopes allow", async () => {
      const client = await connect(await mintKey(["services:read"]));

      const { tools } = await client.listTools();

      expect(tools.map((t) => t.name)).toEqual(["list_services"]);
      expect(tools[0].annotations?.readOnlyHint).toBe(true);
    });

    it("should offer no tools to a key whose scopes match none", async () => {
      const client = await connect(await mintKey(["builds:write"]));

      const { tools } = await client.listTools();

      expect(tools).toEqual([]);
    });

    it("should run a tool and return the calling account's data", async () => {
      const client = await connect(await mintKey(["services:read"]));

      const result = await client.callTool({
        name: "list_services",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const body = JSON.parse(textOf(result));
      expect(body.services.map((s: { name: string }) => s.name)).toEqual([
        "web-app",
      ]);
    });

    it("should never return another account's data", async () => {
      const other = await accountRepo.create({ name: "Other", slug: "other" });
      await serviceRepo.create({ accountId: other._id, name: "their-app" });
      const client = await connect(await mintKey(["services:read"]));

      const result = await client.callTool({
        name: "list_services",
        arguments: {},
      });

      expect(textOf(result)).not.toContain("their-app");
    });

    it("should refuse a tool the key's scopes do not allow, even when asked for by name", async () => {
      const client = await connect(await mintKey(["builds:write"]));

      const outcome = await client
        .callTool({ name: "list_services", arguments: {} })
        .then(
          (result) => ({ refused: !!result.isError, text: textOf(result) }),
          (error: Error) => ({ refused: true, text: error.message }),
        );

      expect(outcome.refused).toBe(true);
      expect(outcome.text).not.toContain("web-app");
    });
  });
});
