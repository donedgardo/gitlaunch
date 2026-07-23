import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { FlagServiceI } from "../../../services/flag/flagService";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { requireScope } from "../../middleware/apiKeyAuth";
import { AnalyticsService } from "../../../services/analytics/analytics";
import { Flag, FlagVariant } from "../../../repositories/flagRepository";

export type FlagsRoutesDependencies = {
  flagService: FlagServiceI;
  serviceRepo: ServiceRepository;
  planEnforcementService: PlanEnforcementService;
  analytics?: AnalyticsService;
};

type ServiceIdParams = { serviceId: string };
type FlagKeyParams = ServiceIdParams & { key: string };
type EnvConfigParams = FlagKeyParams & { env: string };
type EvaluateParams = ServiceIdParams & { env: string };

type CreateFlagBody = { key?: string; description?: string };
type EnvConfigBody = {
  enabled?: boolean;
  rolloutPercentage?: number;
  variants?: FlagVariant[];
};

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
  const { flagService, serviceRepo, planEnforcementService, analytics } = deps;

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
  app.get<{ Params: EvaluateParams; Querystring: { entity?: string } }>(
    "/api/v1/services/:serviceId/environments/:env/flags/evaluate",
    { preHandler: requireScope("flags:read") },
    async (request, reply) => {
      const accountId = request.apiKey!.accountId;
      const serviceId = await resolveServiceId(request, reply);
      if (!serviceId) return;

      const entity = request.query.entity;
      if (!entity) {
        return reply
          .status(400)
          .send({ error: "entity query parameter is required" });
      }

      const evaluations = await flagService.evaluate(
        accountId,
        serviceId,
        request.params.env,
        entity,
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
      }
      return reply.send({ environment: request.params.env, entity, flags });
    },
  );
}
