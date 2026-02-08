import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { EnvironmentService } from "../../../services/environment/environmentService";
import { requireScope } from "../../middleware/apiKeyAuth";

export type EnvironmentsRoutesDependencies = {
  environmentService: EnvironmentService;
};

type ServiceIdParams = {
  serviceId: string;
};

type EnvNameParams = ServiceIdParams & {
  envName: string;
};

type AddEnvironmentBody = {
  name: string;
};

type UpdateEnvironmentBody = {
  order?: number;
};

export function registerEnvironmentsRoutes(
  app: FastifyInstance,
  deps: EnvironmentsRoutesDependencies,
) {
  const { environmentService } = deps;

  // GET /api/v1/services/:serviceId/environments - List environments
  app.get<{ Params: ServiceIdParams }>(
    "/api/v1/services/:serviceId/environments",
    { preHandler: requireScope("services:read") },
    async (
      request: FastifyRequest<{ Params: ServiceIdParams }>,
      reply: FastifyReply,
    ) => {
      const { serviceId: serviceIdParam } = request.params;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(serviceIdParam)) {
        return reply.status(400).send({ error: "Invalid service ID" });
      }

      const serviceId = new ObjectId(serviceIdParam);

      try {
        const environments = await environmentService.listEnvironments(
          accountId,
          serviceId,
        );

        return reply.send({ environments });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to list environments";
        if (message === "Service not found") {
          return reply.status(404).send({ error: message });
        }
        return reply.status(400).send({ error: message });
      }
    },
  );

  // POST /api/v1/services/:serviceId/environments - Add environment
  app.post<{ Params: ServiceIdParams; Body: AddEnvironmentBody }>(
    "/api/v1/services/:serviceId/environments",
    { preHandler: requireScope("services:write") },
    async (
      request: FastifyRequest<{
        Params: ServiceIdParams;
        Body: AddEnvironmentBody;
      }>,
      reply: FastifyReply,
    ) => {
      const { serviceId: serviceIdParam } = request.params;
      const { name } = request.body;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(serviceIdParam)) {
        return reply.status(400).send({ error: "Invalid service ID" });
      }

      if (!name) {
        return reply.status(400).send({ error: "name is required" });
      }

      const serviceId = new ObjectId(serviceIdParam);

      try {
        const service = await environmentService.addEnvironment(
          accountId,
          serviceId,
          { name },
        );

        return reply.status(201).send({
          environments: [...service.environments].sort(
            (a, b) => (a.order ?? 0) - (b.order ?? 0),
          ),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to add environment";
        if (message === "Service not found") {
          return reply.status(404).send({ error: message });
        }
        return reply.status(400).send({ error: message });
      }
    },
  );

  // PATCH /api/v1/services/:serviceId/environments/:envName - Update environment
  app.patch<{ Params: EnvNameParams; Body: UpdateEnvironmentBody }>(
    "/api/v1/services/:serviceId/environments/:envName",
    { preHandler: requireScope("services:write") },
    async (
      request: FastifyRequest<{
        Params: EnvNameParams;
        Body: UpdateEnvironmentBody;
      }>,
      reply: FastifyReply,
    ) => {
      const { serviceId: serviceIdParam, envName } = request.params;
      const { order } = request.body;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(serviceIdParam)) {
        return reply.status(400).send({ error: "Invalid service ID" });
      }

      const serviceId = new ObjectId(serviceIdParam);

      try {
        const service = await environmentService.updateEnvironment(
          accountId,
          serviceId,
          envName,
          { order },
        );

        return reply.send({
          environments: [...service.environments].sort(
            (a, b) => (a.order ?? 0) - (b.order ?? 0),
          ),
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update environment";
        if (message === "Service not found") {
          return reply.status(404).send({ error: message });
        }
        if (message === "Environment not found") {
          return reply.status(404).send({ error: message });
        }
        return reply.status(400).send({ error: message });
      }
    },
  );

  // DELETE /api/v1/services/:serviceId/environments/:envName - Remove environment
  app.delete<{ Params: EnvNameParams }>(
    "/api/v1/services/:serviceId/environments/:envName",
    { preHandler: requireScope("services:write") },
    async (
      request: FastifyRequest<{ Params: EnvNameParams }>,
      reply: FastifyReply,
    ) => {
      const { serviceId: serviceIdParam, envName } = request.params;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(serviceIdParam)) {
        return reply.status(400).send({ error: "Invalid service ID" });
      }

      const serviceId = new ObjectId(serviceIdParam);

      try {
        const service = await environmentService.removeEnvironment(
          accountId,
          serviceId,
          envName,
        );

        return reply.send({
          environments: [...service.environments].sort(
            (a, b) => (a.order ?? 0) - (b.order ?? 0),
          ),
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to remove environment";
        if (message === "Service not found") {
          return reply.status(404).send({ error: message });
        }
        if (message === "Environment not found") {
          return reply.status(404).send({ error: message });
        }
        return reply.status(400).send({ error: message });
      }
    },
  );
}
