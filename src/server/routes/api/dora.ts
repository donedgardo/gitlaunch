import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { DoraMetricsService } from "../../../services/dora/doraMetricsService";
import { requireScope } from "../../middleware/apiKeyAuth";

export type DoraRoutesDependencies = {
  doraMetricsService: DoraMetricsService;
  serviceRepo: ServiceRepository;
  /** Injected so a window of N days is deterministic in tests. */
  now?: () => Date;
};

type ServiceIdParams = {
  serviceId: string;
};

type DoraQuery = {
  environment?: string;
  days?: string;
};

/** Reporting on a decade of delivery is a mistake, not a query. */
const MAX_WINDOW_DAYS = 3650;
const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function registerDoraRoutes(
  app: FastifyInstance,
  deps: DoraRoutesDependencies,
) {
  const { doraMetricsService, serviceRepo } = deps;
  const now = deps.now ?? (() => new Date());

  // GET /api/v1/services/:serviceId/dora - The four keys for one environment
  //
  // Scoped to `builds:read` rather than a scope of its own: these numbers are
  // the service's build history aggregated, and a key that can already read
  // every build and its deployment log could compute them itself. A new scope
  // would only lock existing keys out of a summary of data they can fetch.
  app.get<{ Params: ServiceIdParams; Querystring: DoraQuery }>(
    "/api/v1/services/:serviceId/dora",
    { preHandler: requireScope("builds:read") },
    async (
      request: FastifyRequest<{
        Params: ServiceIdParams;
        Querystring: DoraQuery;
      }>,
      reply: FastifyReply,
    ) => {
      const { serviceId: serviceIdParam } = request.params;
      const { environment, days: daysParam } = request.query;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(serviceIdParam)) {
        return reply.status(400).send({ error: "Invalid service ID" });
      }

      if (!environment) {
        return reply
          .status(400)
          .send({ error: "environment query parameter is required" });
      }

      const days =
        daysParam === undefined ? DEFAULT_WINDOW_DAYS : Number(daysParam);
      if (!Number.isFinite(days) || days <= 0 || days > MAX_WINDOW_DAYS) {
        return reply.status(400).send({
          error: `days must be a number between 1 and ${MAX_WINDOW_DAYS}`,
        });
      }

      const serviceId = new ObjectId(serviceIdParam);

      const service = await serviceRepo.findById(serviceId);
      if (!service) {
        return reply.status(404).send({ error: "Service not found" });
      }
      if (service.accountId.toString() !== accountId.toString()) {
        return reply
          .status(403)
          .send({ error: "Service does not belong to this account" });
      }

      // An environment this service does not have would otherwise measure an
      // empty timeline and answer "you have never deployed" — indistinguishable
      // from a real empty history, and wrong in a way the caller cannot see.
      const known = service.environments.some((e) => e.name === environment);
      if (!known) {
        return reply
          .status(400)
          .send({ error: `Unknown environment: ${environment}` });
      }

      const to = now();
      const from = new Date(to.getTime() - days * DAY_MS);

      const keys = await doraMetricsService.forService(
        accountId,
        serviceId,
        environment,
        { from, to },
      );

      return reply.send({
        environment,
        window: { from, to, days },
        ...keys,
      });
    },
  );
}
