import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { GitHubAppService } from "../../../services/github/githubAppService";

export type ServiceRoutesDeps = {
  repositoryRepository: RepositoryRepository;
  serviceRepository: ServiceRepository;
  githubAppService?: GitHubAppService;
};

export function registerServiceRoutes(
  app: FastifyInstance,
  deps: ServiceRoutesDeps,
): void {
  const { repositoryRepository, serviceRepository, githubAppService } = deps;

  // Adding a service has ONE home: the onboarding flow. It used to fork —
  // first-ever service went through /onboarding/service (reporting-first, with
  // the AI-agent handoff), every later one through a separate form here that
  // dropped you on the dashboard and never offered the agent. An account that
  // already had a service could therefore never reach the agent onboarding.
  // Both entry points now lead to the same three steps.
  app.get(
    "/services/new",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }
      return reply.redirect("/onboarding/service");
    },
  );

  // A cached copy of the retired form may still POST here; send it to the
  // canonical step with a 303 so the browser re-issues it as a GET.
  app.post(
    "/services/new",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }
      return reply.redirect(303, "/onboarding/service");
    },
  );

  // GET /services/:serviceId/workflows - Fetch workflows from GitHub
  app.get<{
    Params: { serviceId: string };
    Querystring: { selected?: string };
  }>(
    "/services/:serviceId/workflows",
    async (
      request: FastifyRequest<{
        Params: { serviceId: string };
        Querystring: { selected?: string };
      }>,
      reply: FastifyReply,
    ) => {
      // Redirect to login if not authenticated
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      const accountId = new ObjectId(request.session.accountId);
      const { serviceId } = request.params;
      const { selected } = request.query;

      // Validate ObjectId
      let serviceObjectId: ObjectId;
      try {
        serviceObjectId = new ObjectId(serviceId);
      } catch {
        return reply.status(400).send("Invalid service ID");
      }

      // Find the service
      const service = await serviceRepository.findByAccountAndId(
        accountId,
        serviceObjectId,
      );
      if (!service) {
        return reply.status(404).send("Service not found");
      }

      // Workflow selection only applies to GitHub-deployed services.
      if (service.deployment?.provider !== "github") {
        return reply
          .header("Content-Type", "text/html")
          .send("<option value=''>Not a GitHub service</option>");
      }

      // Get the repository
      const repository = await repositoryRepository.findById(
        service.deployment.repositoryId,
      );
      if (!repository) {
        return reply.status(404).send("Repository not found");
      }

      // Check if GitHub App service is available
      if (!githubAppService) {
        return reply
          .header("Content-Type", "text/html")
          .send("<option value=''>GitHub integration not configured</option>");
      }

      try {
        // Fetch workflows from GitHub
        const workflows = await githubAppService.listRepositoryWorkflows(
          accountId,
          repository.githubOwner,
          repository.githubRepoName,
        );

        // Return HTML options with optional pre-selection
        const options = workflows
          .map((w) => {
            const filename = w.path.split("/").pop() || w.path;
            const isSelected = selected === filename ? " selected" : "";
            return `<option value="${filename}"${isSelected}>${w.name} (${filename})</option>`;
          })
          .join("\n");

        return reply
          .header("Content-Type", "text/html")
          .send(
            options ||
              "<option value=''>No workflows found - create one first</option>",
          );
      } catch (error) {
        console.error(
          "Failed to fetch workflows for repo:",
          repository.githubOwner,
          repository.githubRepoName,
          error,
        );
        return reply
          .header("Content-Type", "text/html")
          .send("<option value=''>Failed to load workflows</option>");
      }
    },
  );

  // POST /services/:serviceId/configure-workflow - Save workflow configuration
  app.post<{
    Params: { serviceId: string };
    Body: { workflowFile: string };
  }>(
    "/services/:serviceId/configure-workflow",
    async (
      request: FastifyRequest<{
        Params: { serviceId: string };
        Body: { workflowFile: string };
      }>,
      reply: FastifyReply,
    ) => {
      // Redirect to login if not authenticated
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      const accountId = new ObjectId(request.session.accountId);
      const { serviceId } = request.params;
      const { workflowFile } = request.body;

      // Validate ObjectId
      let serviceObjectId: ObjectId;
      try {
        serviceObjectId = new ObjectId(serviceId);
      } catch {
        return reply.status(400).send("Invalid service ID");
      }

      // Find the service
      const service = await serviceRepository.findByAccountAndId(
        accountId,
        serviceObjectId,
      );
      if (!service) {
        return reply.status(404).send("Service not found");
      }

      // Update the service configuration
      await serviceRepository.updateWorkflowConfiguration(serviceObjectId, {
        workflowFile: workflowFile || "deploy.yml",
      });

      // Redirect to dashboard
      return reply.redirect(`/dashboard/${service.name}`);
    },
  );
}
