import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { AnalyticsService } from "../../../services/analytics/analytics";
import { actor } from "../../../services/analytics/actorIdentity";
import { ApiKey } from "../../../repositories/apiKeyRepository";
import {
  KEY_ACCESS_LEVELS,
  describeAccess,
  describeEnvironments,
  parseAccessLevel,
  parseEnvironmentList,
  scopesFor,
} from "../../../services/apiKey/keyAccess";

export type ApiKeyRoutesDeps = {
  apiKeyService: ApiKeyService;
  serviceRepository?: ServiceRepository;
  analytics?: AnalyticsService;
};

type CreateKeyBody = {
  name: string;
  // One of KEY_ACCESS_LEVELS; absent means full access.
  access?: string;
  // Comma-separated environment names; blank means every environment.
  environments?: string | string[];
};

function presentKey(k: ApiKey) {
  return {
    id: k._id.toString(),
    name: k.name,
    prefix: k.keyPrefix,
    scopes: k.scopes.join(", "),
    access: describeAccess(k.scopes),
    reach: describeEnvironments(k),
    lastUsedAt: k.lastUsedAt
      ? k.lastUsedAt.toISOString().split("T")[0]
      : "Never",
    createdAt: k.createdAt.toISOString().split("T")[0],
    isRevoked: k.isRevoked,
  };
}

const accessLevels = KEY_ACCESS_LEVELS.map((l, i) => ({
  level: l.level,
  label: l.label,
  description: l.description,
  isDefault: i === 0,
}));

export function registerApiKeyRoutes(
  app: FastifyInstance,
  deps: ApiKeyRoutesDeps,
): void {
  const { apiKeyService, serviceRepository, analytics } = deps;

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
          accessLevels,
          keys: keys.map(presentKey),
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /settings/api-keys - Generate new API key
  app.post<{ Body: CreateKeyBody }>(
    "/settings/api-keys",
    async (
      request: FastifyRequest<{ Body: CreateKeyBody }>,
      reply: FastifyReply,
    ) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      const accountId = new ObjectId(request.session.accountId);
      const userId = new ObjectId(request.session.userId);
      const { name } = request.body;

      const access = parseAccessLevel(request.body.access);
      if (!access) {
        return reply.status(400).send("Unknown access level");
      }
      // A read-only key changes nothing anywhere, so an environment list on it
      // would only suggest its reads were limited, which they are not.
      const allowedEnvironments =
        access === "read"
          ? []
          : parseEnvironmentList(request.body.environments);

      const { key, apiKey } = await apiKeyService.generate({
        accountId,
        createdByUserId: userId,
        name: name || "Unnamed Key",
        scopes: scopesFor(access),
        allowedEnvironments,
      });

      // Reaching for the API is an activation milestone. The key itself never
      // leaves this handler — only that one was made.
      analytics?.track(
        "api_key_created",
        { scopeCount: apiKey.scopes.length },
        actor(accountId, userId),
      );

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
          accessLevels,
          keys: keys.map(presentKey),
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
