import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { AccountRepository } from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import { GitHubAppService } from "../../../services/github/githubAppService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";

export type ServiceRoutesDeps = {
  accountRepository: AccountRepository;
  repositoryRepository: RepositoryRepository;
  serviceRepository: ServiceRepository;
  apiKeyService: ApiKeyService;
  githubAppService?: GitHubAppService;
  planEnforcementService: PlanEnforcementService;
};

export function registerServiceRoutes(
  app: FastifyInstance,
  deps: ServiceRoutesDeps,
): void {
  const {
    accountRepository,
    repositoryRepository,
    serviceRepository,
    apiKeyService,
    githubAppService,
    planEnforcementService,
  } = deps;

  // GET /services/new - Show create service form
  app.get(
    "/services/new",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Redirect to login if not authenticated
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      // Get account from session
      const account = await accountRepository.findById(
        new ObjectId(request.session.accountId),
      );
      if (!account) {
        return reply.redirect("/auth/github");
      }

      // Get repositories for this account
      const repositories = await repositoryRepository.findByAccountId(
        account._id,
      );

      // If no repositories, redirect to onboarding
      if (repositories.length === 0) {
        return reply.redirect("/onboarding");
      }

      return reply.view(
        "services/new",
        {
          title: "Create Service",
          repositories,
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /services/new - Create a new service
  app.post<{
    Body: {
      repositoryId: string;
      name: string;
    };
  }>(
    "/services/new",
    async (
      request: FastifyRequest<{
        Body: { repositoryId: string; name: string };
      }>,
      reply: FastifyReply,
    ) => {
      // Redirect to login if not authenticated
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      // Get account from session
      const account = await accountRepository.findById(
        new ObjectId(request.session.accountId),
      );
      if (!account) {
        return reply.redirect("/auth/github");
      }

      const { repositoryId, name } = request.body;

      // Validate required fields
      if (!repositoryId || !name) {
        const repositories = await repositoryRepository.findByAccountId(
          account._id,
        );
        return reply.view(
          "services/new",
          {
            title: "Create Service",
            repositories,
            error: "Please select a repository and enter a service name.",
          },
          { layout: "/layouts/main.hbs" },
        );
      }

      // Verify repository belongs to account
      const repository = await repositoryRepository.findById(
        new ObjectId(repositoryId),
      );
      if (!repository || !repository.accountId.equals(account._id)) {
        const repositories = await repositoryRepository.findByAccountId(
          account._id,
        );
        return reply.view(
          "services/new",
          {
            title: "Create Service",
            repositories,
            error: "Invalid repository selected.",
          },
          { layout: "/layouts/main.hbs" },
        );
      }

      // Check plan limit for services
      const canAdd = await planEnforcementService.canAddService(account._id);
      if (!canAdd.allowed) {
        const repositories = await repositoryRepository.findByAccountId(
          account._id,
        );
        return reply.view(
          "services/new",
          {
            title: "Create Service",
            repositories,
            error: canAdd.reason,
          },
          { layout: "/layouts/main.hbs" },
        );
      }

      // Create the service
      try {
        await serviceRepository.create({
          accountId: account._id,
          repositoryId: new ObjectId(repositoryId),
          name: name.trim(),
        });

        // Generate API key for this service
        const { key } = await apiKeyService.generate({
          accountId: account._id,
          createdByUserId: new ObjectId(request.session.userId),
          name: `${name.trim()} API Key`,
          scopes: ["builds:read", "builds:write", "deployments:write"],
        });

        // Store API key in a signed, short-lived cookie for dashboard to display
        reply.setCookie("new_api_key", key, {
          signed: true,
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/",
          maxAge: 300, // 5 minutes - just enough time to view and copy
        });

        // Redirect straight to dashboard
        return reply.redirect(`/dashboard/${name.trim()}`);
      } catch (error: any) {
        // Handle duplicate service name error
        if (error.code === 11000) {
          const repositories = await repositoryRepository.findByAccountId(
            account._id,
          );
          return reply.view(
            "services/new",
            {
              title: "Create Service",
              repositories,
              error:
                "A service with this name already exists for this repository.",
            },
            { layout: "/layouts/main.hbs" },
          );
        }
        throw error;
      }
    },
  );

  // GET /services/created - Show API key and getting started guide
  app.get(
    "/services/created",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Redirect to login if not authenticated
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      // Get API key from signed cookie
      const apiKeyCookie = request.cookies.service_api_key;
      const apiKey = apiKeyCookie
        ? reply.unsignCookie(apiKeyCookie).value
        : null;

      // Get service info from signed cookie
      const serviceCookie = request.cookies.created_service;
      const serviceInfoRaw = serviceCookie
        ? reply.unsignCookie(serviceCookie).value
        : null;

      // Clear cookies immediately (one-time display)
      reply.clearCookie("service_api_key", { path: "/services/created" });
      reply.clearCookie("created_service", { path: "/services/created" });

      // If no API key or service info (already viewed or expired), redirect to dashboard
      if (!apiKey || !serviceInfoRaw) {
        return reply.redirect("/dashboard");
      }

      const serviceInfo = JSON.parse(serviceInfoRaw);

      return reply.view(
        "services/created",
        {
          title: "Service Created",
          apiKey,
          serviceId: serviceInfo.id,
          serviceName: serviceInfo.name,
        },
        { layout: "/layouts/main.hbs" },
      );
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

      // Get the repository
      const repository = await repositoryRepository.findById(
        service.repositoryId,
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
    Body: { workflowFile: string; eventType: string };
  }>(
    "/services/:serviceId/configure-workflow",
    async (
      request: FastifyRequest<{
        Params: { serviceId: string };
        Body: { workflowFile: string; eventType: string };
      }>,
      reply: FastifyReply,
    ) => {
      // Redirect to login if not authenticated
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      const accountId = new ObjectId(request.session.accountId);
      const { serviceId } = request.params;
      const { workflowFile, eventType } = request.body;

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
        eventType: eventType || "deployment",
      });

      // Redirect to dashboard
      return reply.redirect(`/dashboard/${service.name}`);
    },
  );
}
