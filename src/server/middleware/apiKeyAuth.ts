import { FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { ApiKeyService } from "../../services/apiKey/apiKeyService";
import { ApiKeyScope, ApiKeyKind } from "../../repositories/apiKeyRepository";
import {
  isEnvironmentLimited,
  mayActOnEnvironment,
} from "../../services/apiKey/keyAccess";

export type ApiKeyContext = {
  accountId: ObjectId;
  apiKeyId: ObjectId;
  // The key's name and the person who created it, so a change made with the
  // key can be attributed to both.
  name?: string;
  createdByUserId?: ObjectId;
  scopes: ApiKeyScope[];
  kind: ApiKeyKind;
  // Publishable keys only: what this key is confined to.
  serviceId?: ObjectId | null;
  environment?: string | null;
  allowedOrigins: string[];
  // Secret keys only: the environments this key may change. Absent, null or
  // empty means every environment.
  allowedEnvironments?: string[] | null;
};

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: ApiKeyContext;
  }
}

export function createApiKeyAuthMiddleware(apiKeyService: ApiKeyService) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // A CORS preflight never carries credentials, so demanding a key here would
    // make every cross-origin call fail before the real request is even sent.
    // Preflights return no data; the route that does is still authenticated.
    if (request.method === "OPTIONS") return;

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
      name: validated.name,
      createdByUserId: validated.createdByUserId,
      scopes: validated.scopes,
      // Records predating the sk_/pk_ split have no kind and are secret keys.
      kind: validated.kind ?? "secret",
      serviceId: validated.serviceId ?? null,
      environment: validated.environment ?? null,
      allowedOrigins: validated.allowedOrigins ?? [],
      allowedEnvironments: validated.allowedEnvironments ?? null,
    };
  };
}

// Helper to check if request has required scope.
//
// Publishable keys are refused here outright, whatever scopes they carry. Every
// route guarded by requireScope is a server-side route, so a browser-visible key
// reaching one means something is wrong; refusing by key *kind* rather than by
// scope arithmetic means a future scope mistake cannot quietly open one up.
export function requireScope(scope: ApiKeyScope) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.apiKey) {
      return reply.status(401).send({ error: "API key required" });
    }

    if (request.apiKey.kind === "publishable") {
      return reply.status(403).send({
        error:
          "This endpoint requires a secret key. Publishable keys may only evaluate flags and record conversions.",
      });
    }

    if (!request.apiKey.scopes.includes(scope)) {
      return reply.status(403).send({
        error: `Missing required scope: ${scope}`,
      });
    }
  };
}

// Guards a write addressed to one environment — a deploy, a status report, a
// flag switch. Pair it with requireScope: the scope says *what* the key may do,
// this says *where*. A key with no environment list passes untouched.
//
// By default the environment is the route's `:env` parameter; pass a reader
// when the route names it differently or carries it in the body.
export function requireEnvironmentAccess(
  readEnvironment: (request: FastifyRequest) => string | undefined = (
    request,
  ) => (request.params as { env?: string } | undefined)?.env,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.apiKey) {
      return reply.status(401).send({ error: "API key required" });
    }
    if (!isEnvironmentLimited(request.apiKey)) return;

    const environment = readEnvironment(request);
    // No environment to check is left to the route's own validation, which
    // answers with the 400 it always did.
    if (typeof environment !== "string" || !environment) return;

    if (!mayActOnEnvironment(request.apiKey, environment)) {
      return reply.status(403).send({
        error: `This key is not allowed to act on environment "${environment}".`,
      });
    }
  };
}

// Guards a write that reaches every environment at once — deleting a flag,
// rebinding how a service deploys. A key limited to some environments has no
// business making it: otherwise "staging only" would still be able to pull a
// flag out from under production.
export function requireAllEnvironments() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.apiKey) {
      return reply.status(401).send({ error: "API key required" });
    }
    if (isEnvironmentLimited(request.apiKey)) {
      return reply.status(403).send({
        error:
          "This key is limited to certain environments and cannot make a change that affects all of them.",
      });
    }
  };
}

// Guards the runtime flag endpoints a browser may reach: evaluating flags, and
// recording the conversion that closes an experiment. Those two are one loop —
// a key that can only do the first half produces experiments where every arm
// reads 0% forever, so the results panel can never call a winner.
//
// Secret keys behave exactly as before (flags:read already granted evaluate, and
// customers hold such keys today). Publishable keys must additionally match the
// service and environment they were bound to, and arrive from an allow-listed
// Origin.
//
// Conversions are writes, so a leaked publishable key can inflate a competitor's
// numbers the same way it can burn their evaluate quota. That is the accepted
// cost of front-end experiments — the alternative is browser A/B tests that
// cannot measure anything. The confinement (one service, one environment,
// allow-listed origins) is what bounds the damage.
//
// The Origin check is a guard rail, not a secret: a publishable key is public by
// construction, and anything outside a browser can forge or omit Origin. What it
// buys is that a key lifted from your bundle cannot simply be dropped into
// another site's frontend. Confinement to one service+environment, and to the
// two runtime endpoints, is what actually limits the blast radius.
export function requireFlagRuntimeAccess() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Echo the caller's origin on every outcome, including refusals, so a
    // developer sees our actual error instead of an opaque CORS failure. The
    // header only grants the browser permission to *read* a response it already
    // received; it is not what decides whether the request is allowed.
    const requestOrigin = request.headers.origin;
    if (requestOrigin) {
      reply.header("Access-Control-Allow-Origin", requestOrigin);
      reply.header("Vary", "Origin");
    }

    const apiKey = request.apiKey;
    if (!apiKey) {
      return reply.status(401).send({ error: "API key required" });
    }

    if (apiKey.kind !== "publishable") {
      const permitted: ApiKeyScope[] = ["flags:evaluate", "flags:read"];
      if (!permitted.some((s) => apiKey.scopes.includes(s))) {
        return reply
          .status(403)
          .send({ error: "Missing required scope: flags:evaluate" });
      }
      return;
    }

    if (!apiKey.scopes.includes("flags:evaluate")) {
      return reply
        .status(403)
        .send({ error: "Missing required scope: flags:evaluate" });
    }

    const { serviceId, env } = (request.params ?? {}) as {
      serviceId?: string;
      env?: string;
    };
    if (!apiKey.serviceId || apiKey.serviceId.toString() !== serviceId) {
      return reply.status(403).send({
        error: "This publishable key is not valid for that service",
      });
    }
    if (!apiKey.environment || apiKey.environment !== env) {
      return reply.status(403).send({
        error: "This publishable key is not valid for that environment",
      });
    }

    const origin = request.headers.origin;
    if (!origin || !apiKey.allowedOrigins.includes(origin)) {
      return reply.status(403).send({
        error: "This publishable key is not allowed from that origin",
      });
    }
  };
}
