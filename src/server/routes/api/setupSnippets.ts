import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import {
  Service,
  ServiceRepository,
} from "../../../repositories/serviceRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import {
  buildSetupSnippets,
  FALLBACK_DEFAULT_BRANCH,
} from "../../../services/setup/setupSnippets";
import { requireScope } from "../../middleware/apiKeyAuth";

export type SetupSnippetsRoutesDependencies = {
  serviceRepository: ServiceRepository;
  /** Where the branch the build-report step is gated to comes from. */
  repositoryRepository: RepositoryRepository;
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
  const { serviceRepository, repositoryRepository, apiUrl } = deps;

  // Only a GitHub-connected service has a repository on record, and only a
  // record written since GitLaunch started storing the branch carries one.
  // Everything else falls back — see FALLBACK_DEFAULT_BRANCH.
  const resolveDefaultBranch = async (service: Service): Promise<string> => {
    if (service.deployment?.provider !== "github") {
      return FALLBACK_DEFAULT_BRANCH;
    }
    const repository = await repositoryRepository.findById(
      service.deployment.repositoryId,
    );
    return repository?.defaultBranch || FALLBACK_DEFAULT_BRANCH;
  };

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
          defaultBranch: await resolveDefaultBranch(service),
        }),
      );
    },
  );
}
