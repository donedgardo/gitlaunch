import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { posthog } from "../../../instrument";

export type ApiKeyRoutesDeps = {
  apiKeyService: ApiKeyService;
  serviceRepository?: ServiceRepository;
};

export function registerApiKeyRoutes(
  app: FastifyInstance,
  deps: ApiKeyRoutesDeps,
): void {
  const { apiKeyService, serviceRepository } = deps;

  // GET /settings/api-keys - List API keys
  app.get(
    "/settings/api-keys",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      const accountId = new ObjectId(request.session.accountId);
      const [keys, services] = await Promise.all([
        apiKeyService.listByAccount(accountId),
        serviceRepository?.findByAccountId(accountId) ?? Promise.resolve([]),
      ]);

      return reply.view(
        "settings/api-keys",
        {
          title: "API Keys",
          services: services.map((s) => s.name),
          keys: keys.map((k) => ({
            id: k._id.toString(),
            name: k.name,
            prefix: k.keyPrefix,
            scopes: k.scopes.join(", "),
            lastUsedAt: k.lastUsedAt
              ? k.lastUsedAt.toISOString().split("T")[0]
              : "Never",
            createdAt: k.createdAt.toISOString().split("T")[0],
            isRevoked: k.isRevoked,
          })),
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /settings/api-keys - Generate new API key
  app.post<{ Body: { name: string } }>(
    "/settings/api-keys",
    async (
      request: FastifyRequest<{ Body: { name: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      const accountId = new ObjectId(request.session.accountId);
      const userId = new ObjectId(request.session.userId);
      const { name } = request.body;

      const { key, apiKey } = await apiKeyService.generate({
        accountId,
        createdByUserId: userId,
        name: name || "Unnamed Key",
        scopes: [
          "builds:read",
          "builds:write",
          "deployments:write",
          "services:read",
          "services:write",
          "flags:read",
          "flags:write",
        ],
      });
      posthog?.capture({ event: "api_key_created" });
      await posthog?.flush();

      // List all keys and services to show alongside the new one
      const [keys, services] = await Promise.all([
        apiKeyService.listByAccount(accountId),
        serviceRepository?.findByAccountId(accountId) ?? Promise.resolve([]),
      ]);

      return reply.view(
        "settings/api-keys",
        {
          title: "API Keys",
          services: services.map((s) => s.name),
          newKey: key,
          newKeyName: apiKey.name,
          keys: keys.map((k) => ({
            id: k._id.toString(),
            name: k.name,
            prefix: k.keyPrefix,
            scopes: k.scopes.join(", "),
            lastUsedAt: k.lastUsedAt
              ? k.lastUsedAt.toISOString().split("T")[0]
              : "Never",
            createdAt: k.createdAt.toISOString().split("T")[0],
            isRevoked: k.isRevoked,
          })),
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /settings/api-keys/:id/revoke - Revoke an API key
  app.post<{ Params: { id: string } }>(
    "/settings/api-keys/:id/revoke",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      const accountId = new ObjectId(request.session.accountId);

      let keyId: ObjectId;
      try {
        keyId = new ObjectId(request.params.id);
      } catch {
        return reply.status(400).send("Invalid key ID");
      }

      // Verify the key belongs to this account
      const keys = await apiKeyService.listByAccount(accountId);
      const key = keys.find((k) => k._id.equals(keyId));
      if (!key) {
        return reply.status(404).send("API key not found");
      }

      await apiKeyService.revoke(keyId);

      reply.header(
        "HX-Trigger",
        JSON.stringify({
          showToast: { message: "API key revoked", type: "success" },
        }),
      );
      return reply.status(200).send();
    },
  );
}
