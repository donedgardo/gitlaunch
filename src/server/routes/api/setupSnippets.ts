import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { buildSetupSnippets } from "../../../services/setup/setupSnippets";
import { requireScope } from "../../middleware/apiKeyAuth";

export type SetupSnippetsRoutesDependencies = {
  serviceRepository: ServiceRepository;
  /** Base URL of this instance, so self-hosts emit their own host. */
  apiUrl: string;
};

type ServiceIdParams = {
  serviceId: string;
};

export function registerSetupSnippetsRoutes(
  app: FastifyInstance,
  deps: SetupSnippetsRoutesDependencies,
) {
  const { serviceRepository, apiUrl } = deps;

  // GET /api/v1/services/:serviceId/setup-snippets
  //
  // The canonical CI/CD snippets for this service. Exists so an AI agent
  // wiring up a customer repo reads the same source of truth the dashboard
  // renders, instead of carrying its own copy that silently goes stale.
  app.get<{ Params: ServiceIdParams }>(
    "/api/v1/services/:serviceId/setup-snippets",
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

      // Scoped to the key's account: a valid id from another tenant is a 404,
      // not a leak.
      const service = await serviceRepository.findByAccountAndId(
        accountId,
        new ObjectId(serviceIdParam),
      );

      if (!service) {
        return reply.status(404).send({ error: "Service not found" });
      }

      const environments = [...service.environments]
        .sort((a, b) => a.order - b.order)
        .map((environment) => environment.name);

      return reply.send(
        buildSetupSnippets({
          apiUrl,
          serviceId: service._id.toString(),
          environments,
        }),
      );
    },
  );
}
