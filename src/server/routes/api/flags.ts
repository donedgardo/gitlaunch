import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { FlagServiceI } from "../../../services/flag/flagService";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import {
  requireScope,
  requireFlagEvaluateAccess,
} from "../../middleware/apiKeyAuth";
import { AnalyticsService } from "../../../services/analytics/analytics";
import {
  ExperimentResultsService,
  EXPOSURE_EVENT,
  CONVERSION_EVENT,
} from "../../../services/flag/experimentResultsService";
import { FlagConfigVersionService } from "../../../services/flag/flagConfigVersionService";
import {
  Flag,
  FlagVariant,
  TargetingRule,
} from "../../../repositories/flagRepository";
import { FlagAttributes } from "../../../services/flag/flagEvaluator";

export type FlagsRoutesDependencies = {
  flagService: FlagServiceI;
  serviceRepo: ServiceRepository;
  planEnforcementService: PlanEnforcementService;
  analytics?: AnalyticsService;
  experimentResults?: ExperimentResultsService;
  configVersions?: FlagConfigVersionService;
};

type ServiceIdParams = { serviceId: string };
type FlagKeyParams = ServiceIdParams & { key: string };
type EnvConfigParams = FlagKeyParams & { env: string };
type EvaluateParams = ServiceIdParams & { env: string };

// Default experiment results window when the caller doesn't specify one: the
// last 30 days, with a small forward buffer so events written moments ago (the
// exclusive upper bound is `< to`) are always included.
const DEFAULT_RESULTS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const RESULTS_UPPER_BUFFER_MS = 60 * 1000;

function parseResultsRange(query: { from?: string; to?: string }): {
  from: Date;
  to: Date;
} {
  const now = Date.now();
  const to = parseDate(query.to) ?? new Date(now + RESULTS_UPPER_BUFFER_MS);
  const from =
    parseDate(query.from) ?? new Date(now - DEFAULT_RESULTS_WINDOW_MS);
  return { from, to };
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const asNumber = Number(value);
  const date = Number.isFinite(asNumber) ? new Date(asNumber) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

type CreateFlagBody = { key?: string; description?: string };
type EnvConfigBody = {
  enabled?: boolean;
  rolloutPercentage?: number;
  variants?: FlagVariant[];
  targetingRules?: TargetingRule[];
};

// Extract targeting attributes from `attr.<name>=<value>` evaluate query params
// (e.g. ?entity=u1&attr.country=US&attr.plan=pro). Repeated params keep the
// first value. Everything is a string here; the evaluator compares as strings.
function parseAttributes(
  query: Record<string, string | string[] | undefined>,
): FlagAttributes {
  const attributes: FlagAttributes = {};
  for (const [rawKey, rawValue] of Object.entries(query)) {
    if (!rawKey.startsWith("attr.")) continue;
    const name = rawKey.slice("attr.".length);
    if (!name) continue;
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (value !== undefined) {
      attributes[name] = value;
    }
  }
  return attributes;
}

function serializeFlag(flag: Flag) {
  return {
    key: flag.key,
    description: flag.description,
    environments: flag.environments,
    createdAt: flag.createdAt,
    updatedAt: flag.updatedAt,
  };
}

export function registerFlagsRoutes(
  app: FastifyInstance,
  deps: FlagsRoutesDependencies,
) {
  const {
    flagService,
    serviceRepo,
    planEnforcementService,
    analytics,
    experimentResults,
    configVersions,
  } = deps;

  // Resolve + tenant-check a service from the :serviceId param. Returns the
  // ObjectId, or null after sending the appropriate error response.
  async function resolveServiceId(
    request: FastifyRequest<{ Params: ServiceIdParams }>,
    reply: FastifyReply,
  ): Promise<ObjectId | null> {
    const { serviceId: serviceIdParam } = request.params;
    const accountId = request.apiKey!.accountId;

    if (!ObjectId.isValid(serviceIdParam)) {
      reply.status(400).send({ error: "Invalid service ID" });
      return null;
    }
    const serviceId = new ObjectId(serviceIdParam);

    const service = await serviceRepo.findById(serviceId);
    if (!service) {
      reply.status(404).send({ error: "Service not found" });
      return null;
    }
    if (service.accountId.toString() !== accountId.toString()) {
      reply
        .status(403)
        .send({ error: "Service does not belong to this account" });
      return null;
    }
    return serviceId;
  }

  async function assertWritable(
    accountId: ObjectId,
    reply: FastifyReply,
  ): Promise<boolean> {
    try {
      const accountState =
        await planEnforcementService.getAccountState(accountId);
      if (accountState.isReadOnly) {
        reply.status(403).send({
          error:
            "Account is read-only. Please update your plan or payment method.",
        });
        return false;
      }
    } catch {
      // Account not found — will be caught downstream.
    }
    return true;
  }

  function mapErrorStatus(message: string): number {
    if (message === "Flag not found" || message === "Service not found") {
      return 404;
    }
    if (message === "Flag key already exists") {
      return 409;
    }
    return 400;
  }

  // POST /api/v1/services/:serviceId/flags — create a flag
  app.post<{ Params: ServiceIdParams; Body: CreateFlagBody }>(
    "/api/v1/services/:serviceId/flags",
    { preHandler: requireScope("flags:write") },
    async (request, reply) => {
      const accountId = request.apiKey!.accountId;
      const serviceId = await resolveServiceId(request, reply);
      if (!serviceId) return;
      if (!(await assertWritable(accountId, reply))) return;

      const { key, description } = request.body ?? {};
      if (!key) {
        return reply.status(400).send({ error: "Flag key is required" });
      }

      try {
        const flag = await flagService.createFlag(accountId, serviceId, {
          key,
          description: description ?? "",
        });
        analytics?.track("flag_created", { serviceId, key });
        return reply.status(201).send(serializeFlag(flag));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create flag";
        return reply.status(mapErrorStatus(message)).send({ error: message });
      }
    },
  );

  // GET /api/v1/services/:serviceId/flags — list flags
  app.get<{ Params: ServiceIdParams }>(
    "/api/v1/services/:serviceId/flags",
    { preHandler: requireScope("flags:read") },
    async (request, reply) => {
      const accountId = request.apiKey!.accountId;
      const serviceId = await resolveServiceId(request, reply);
      if (!serviceId) return;

      const flags = await flagService.listFlags(accountId, serviceId);
      return reply.send({ flags: flags.map(serializeFlag) });
    },
  );

  // GET /api/v1/services/:serviceId/flags/:key — flag detail
  app.get<{ Params: FlagKeyParams }>(
    "/api/v1/services/:serviceId/flags/:key",
    { preHandler: requireScope("flags:read") },
    async (request, reply) => {
      const accountId = request.apiKey!.accountId;
      const serviceId = await resolveServiceId(request, reply);
      if (!serviceId) return;

      const flag = await flagService.getFlag(
        accountId,
        serviceId,
        request.params.key,
      );
      if (!flag) {
        return reply.status(404).send({ error: "Flag not found" });
      }
      return reply.send(serializeFlag(flag));
    },
  );

  // PATCH /api/v1/services/:serviceId/flags/:key/environments/:env — configure
  app.patch<{ Params: EnvConfigParams; Body: EnvConfigBody }>(
    "/api/v1/services/:serviceId/flags/:key/environments/:env",
    { preHandler: requireScope("flags:write") },
    async (request, reply) => {
      const accountId = request.apiKey!.accountId;
      const serviceId = await resolveServiceId(request, reply);
      if (!serviceId) return;
      if (!(await assertWritable(accountId, reply))) return;

      const { key, env } = request.params;
      try {
        const flag = await flagService.setEnvConfig(
          accountId,
          serviceId,
          key,
          env,
          request.body ?? {},
        );
        analytics?.track("flag_updated", { serviceId, key, environment: env });
        return reply.send(serializeFlag(flag));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update flag";
        return reply.status(mapErrorStatus(message)).send({ error: message });
      }
    },
  );

  // DELETE /api/v1/services/:serviceId/flags/:key — delete a flag
  app.delete<{ Params: FlagKeyParams }>(
    "/api/v1/services/:serviceId/flags/:key",
    { preHandler: requireScope("flags:write") },
    async (request, reply) => {
      const accountId = request.apiKey!.accountId;
      const serviceId = await resolveServiceId(request, reply);
      if (!serviceId) return;
      if (!(await assertWritable(accountId, reply))) return;

      const deleted = await flagService.deleteFlag(
        accountId,
        serviceId,
        request.params.key,
      );
      if (!deleted) {
        return reply.status(404).send({ error: "Flag not found" });
      }
      return reply.status(204).send();
    },
  );

  // GET /api/v1/services/:serviceId/environments/:env/flags/evaluate?entity=...
  // Runtime evaluation surface — the hot path app code calls.
  // CORS preflight for the one endpoint a browser may call. Browsers send this
  // without credentials, so it cannot identify the key and deliberately answers
  // permissively; the key's service, environment and origin allow-list are all
  // enforced on the GET itself, which is the request that returns data.
  app.options<{ Params: EvaluateParams }>(
    "/api/v1/services/:serviceId/environments/:env/flags/evaluate",
    async (request, reply) => {
      const origin = request.headers.origin;
      if (origin) {
        reply.header("Access-Control-Allow-Origin", origin);
        reply.header("Vary", "Origin");
      }
      reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
      reply.header(
        "Access-Control-Allow-Headers",
        "Authorization, X-API-Key, Content-Type",
      );
      reply.header("Access-Control-Max-Age", "600");
      return reply.status(204).send();
    },
  );

  app.get<{
    Params: EvaluateParams;
    Querystring: Record<string, string | string[] | undefined> & {
      entity?: string;
    };
  }>(
    "/api/v1/services/:serviceId/environments/:env/flags/evaluate",
    { preHandler: requireFlagEvaluateAccess() },
    async (request, reply) => {
      const accountId = request.apiKey!.accountId;
      const serviceId = await resolveServiceId(request, reply);
      if (!serviceId) return;

      const entityRaw = request.query.entity;
      const entity = Array.isArray(entityRaw) ? entityRaw[0] : entityRaw;
      if (!entity) {
        return reply
          .status(400)
          .send({ error: "entity query parameter is required" });
      }

      const attributes = parseAttributes(request.query);
      const evaluations = await flagService.evaluate(
        accountId,
        serviceId,
        request.params.env,
        entity,
        attributes,
      );

      const flags: Record<
        string,
        { enabled: boolean; variant: string | null; reason: string }
      > = {};
      for (const e of evaluations) {
        flags[e.key] = {
          enabled: e.enabled,
          variant: e.variant,
          reason: e.reason,
        };

        // Record an exposure for every live flag (i.e. not fully disabled in
        // this environment) so experiments can measure who saw which variant.
        // Fire-and-forget — never blocks the hot evaluation path.
        if (e.reason !== "disabled") {
          analytics?.track(
            EXPOSURE_EVENT,
            {
              serviceId: serviceId.toString(),
              flagKey: e.key,
              environment: request.params.env,
              variant: e.variant,
              reason: e.reason,
            },
            { accountId: accountId.toString(), distinctId: entity },
          );
        }
      }
      return reply.send({ environment: request.params.env, entity, flags });
    },
  );

  // POST /api/v1/services/:serviceId/environments/:env/flags/:key/conversions
  // Record an experiment conversion for an entity. The variant is attributed
  // deterministically by re-evaluating the flag, so callers only send the
  // entity (plus an optional goal/value) — never a variant they could get wrong.
  app.post<{
    Params: EnvConfigParams;
    Body: {
      entity?: string;
      goal?: string;
      value?: number;
      attributes?: FlagAttributes;
    };
  }>(
    "/api/v1/services/:serviceId/environments/:env/flags/:key/conversions",
    { preHandler: requireScope("flags:read") },
    async (request, reply) => {
      const accountId = request.apiKey!.accountId;
      const serviceId = await resolveServiceId(request, reply);
      if (!serviceId) return;

      const entity = request.body?.entity;
      if (!entity) {
        return reply.status(400).send({ error: "entity is required" });
      }

      const { key, env } = request.params;
      // Pass the same attributes used at exposure so a targeting-rule variant
      // is attributed consistently between the exposure and this conversion.
      const evaluation = await flagService.evaluateOne(
        accountId,
        serviceId,
        env,
        key,
        entity,
        request.body?.attributes ?? {},
      );
      if (!evaluation) {
        return reply.status(404).send({ error: "Flag not found" });
      }

      const { goal, value } = request.body ?? {};
      analytics?.track(
        CONVERSION_EVENT,
        {
          serviceId: serviceId.toString(),
          flagKey: key,
          environment: env,
          variant: evaluation.variant,
          reason: evaluation.reason,
          ...(goal !== undefined ? { goal } : {}),
          ...(value !== undefined ? { value } : {}),
        },
        { accountId: accountId.toString(), distinctId: entity },
      );

      return reply.status(201).send({
        recorded: true,
        variant: evaluation.variant,
        ...(goal !== undefined ? { goal } : {}),
      });
    },
  );

  // GET /api/v1/services/:serviceId/environments/:env/flags/:key/results
  // Per-variant exposure/conversion counts and rates over a time window
  // (defaults to the last 30 days). Optional from/to query params (ISO or epoch).
  app.get<{
    Params: EnvConfigParams;
    Querystring: { from?: string; to?: string };
  }>(
    "/api/v1/services/:serviceId/environments/:env/flags/:key/results",
    { preHandler: requireScope("flags:read") },
    async (request, reply) => {
      const accountId = request.apiKey!.accountId;
      const serviceId = await resolveServiceId(request, reply);
      if (!serviceId) return;

      const { key, env } = request.params;
      const flag = await flagService.getFlag(accountId, serviceId, key);
      if (!flag) {
        return reply.status(404).send({ error: "Flag not found" });
      }
      if (!experimentResults) {
        return reply
          .status(503)
          .send({ error: "Experiment metrics are not enabled" });
      }

      const { from, to } = parseResultsRange(request.query);
      const results = await experimentResults.getResults({
        accountId,
        serviceId,
        flagKey: key,
        environment: env,
        from,
        to,
      });
      return reply.send(results);
    },
  );

  // GET /api/v1/services/:serviceId/environments/:env/config/versions
  // Immutable version history of this environment's flag config. Newest first.
  // Returns metadata only (version, hash, createdAt) — fetch a version for its
  // full bundle.
  app.get<{ Params: EvaluateParams }>(
    "/api/v1/services/:serviceId/environments/:env/config/versions",
    { preHandler: requireScope("flags:read") },
    async (request, reply) => {
      const accountId = request.apiKey!.accountId;
      const serviceId = await resolveServiceId(request, reply);
      if (!serviceId) return;
      if (!configVersions) {
        return reply
          .status(503)
          .send({ error: "Config versioning is not enabled" });
      }

      const { env } = request.params;
      const versions = await configVersions.listVersions(
        accountId,
        serviceId,
        env,
      );
      return reply.send({
        environment: env,
        versions: versions.map((v) => ({
          version: v.version,
          hash: v.hash,
          createdAt: v.createdAt,
        })),
      });
    },
  );

  // GET /api/v1/services/:serviceId/environments/:env/config/versions/:version
  // The immutable config artifact for one version. `:version` is a number or
  // the keyword `latest`. This is the payload a customer pins or downloads.
  app.get<{ Params: EvaluateParams & { version: string } }>(
    "/api/v1/services/:serviceId/environments/:env/config/versions/:version",
    { preHandler: requireScope("flags:read") },
    async (request, reply) => {
      const accountId = request.apiKey!.accountId;
      const serviceId = await resolveServiceId(request, reply);
      if (!serviceId) return;
      if (!configVersions) {
        return reply
          .status(503)
          .send({ error: "Config versioning is not enabled" });
      }

      const { env, version } = request.params;
      const record =
        version === "latest"
          ? await configVersions.getLatest(accountId, serviceId, env)
          : /^\d+$/.test(version)
            ? await configVersions.getVersion(
                accountId,
                serviceId,
                env,
                Number(version),
              )
            : null;

      if (!record) {
        return reply.status(404).send({ error: "Config version not found" });
      }
      return reply.send({
        version: record.version,
        hash: record.hash,
        environment: record.environment,
        createdAt: record.createdAt,
        bundle: record.bundle,
      });
    },
  );
}
