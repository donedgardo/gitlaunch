import { FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { ApiKeyService } from "../../services/apiKey/apiKeyService";
import { ApiKeyScope } from "../../repositories/apiKeyRepository";

export type ApiKeyContext = {
  accountId: ObjectId;
  apiKeyId: ObjectId;
  scopes: ApiKeyScope[];
};

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: ApiKeyContext;
  }
}

export function createApiKeyAuthMiddleware(apiKeyService: ApiKeyService) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Check for API key in Authorization header (Bearer token) or X-API-Key header
    const authHeader = request.headers.authorization;
    const xApiKey = request.headers["x-api-key"] as string | undefined;

    let apiKey: string | undefined;

    if (authHeader?.startsWith("Bearer ")) {
      apiKey = authHeader.slice(7);
    } else if (xApiKey) {
      apiKey = xApiKey;
    }

    if (!apiKey) {
      return reply.status(401).send({ error: "API key required" });
    }

    const validated = await apiKeyService.validate(apiKey);
    if (!validated) {
      return reply.status(401).send({ error: "Invalid API key" });
    }

    // Attach API key context to request
    request.apiKey = {
      accountId: validated.accountId,
      apiKeyId: validated._id,
      scopes: validated.scopes,
    };
  };
}

// Helper to check if request has required scope
export function requireScope(scope: ApiKeyScope) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.apiKey) {
      return reply.status(401).send({ error: "API key required" });
    }

    if (!request.apiKey.scopes.includes(scope)) {
      return reply.status(403).send({
        error: `Missing required scope: ${scope}`,
      });
    }
  };
}
