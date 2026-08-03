import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { AccountRepository } from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import { GitHubAppService } from "../../../services/github/githubAppService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { AnalyticsService } from "../../../services/analytics/analytics";
import { oneTimeSecretCookieOptions } from "../../cookies";

export type ServiceRoutesDeps = {
  cookieSecure: boolean;
  accountRepository: AccountRepository;
  repositoryRepository: RepositoryRepository;
  serviceRepository: ServiceRepository;
  apiKeyService: ApiKeyService;
  githubAppService?: GitHubAppService;
  planEnforcementService: PlanEnforcementService;
  analytics?: AnalyticsService;
};

export function registerServiceRoutes(
  app: FastifyInstance,
  deps: ServiceRoutesDeps,
): void {
  const {
    cookieSecure,
    accountRepository,
    repositoryRepository,
    serviceRepository,
    apiKeyService,
    githubAppService,
    planEnforcementService,
    analytics,
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

      // Report-only creation: just a name (+ optional repo URL for commit
      // links). The deploy provider is picked later in deploy setup.
      return reply.view(
        "services/new",
        { title: "Create Service" },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /services/new - Create a report-only service (CD picked later)
  app.post<{
    Body: {
      name?: string;
      repoUrl?: string;
    };
  }>(
    "/services/new",
    async (
      request: FastifyRequest<{
        Body: {
          name?: string;
          repoUrl?: string;
        };
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

      const name = request.body.name?.trim() || "";
      const repoUrl = request.body.repoUrl?.trim() || "";

      // Re-render the form with an error message.
      const renderError = async (error: string) =>
        reply.view(
          "services/new",
          { title: "Create Service", name, repoUrl, error },
          { layout: "/layouts/main.hbs" },
        );

      if (!name) {
        return renderError("Please enter a service name.");
      }

      // Check plan limit for services
      const canAdd = await planEnforcementService.canAddService(account._id);
      if (!canAdd.allowed) {
        return renderError(canAdd.reason ?? "Service limit reached.");
      }

      // Create a report-only service — the deploy provider (GitHub / Jenkins /
      // raw) is picked later in deploy setup, so choosing a CI provider for
      // reporting never assumes a CD provider.
      try {
        await serviceRepository.create({
          accountId: account._id,
          name,
          repoUrl,
        });

        analytics?.track("service_created", {
          serviceName: name,
          accountId: account._id.toString(),
          provider: "report-only",
        });

        // Generate API key for this service
        const { key } = await apiKeyService.generate({
          accountId: account._id,
          createdByUserId: new ObjectId(request.session.userId),
          name: `${name.trim()} API Key`,
          scopes: ["builds:read", "builds:write", "deployments:write"],
        });

        // Store API key in a signed, short-lived cookie for dashboard to display
        reply.setCookie(
          "new_api_key",
          key,
          oneTimeSecretCookieOptions(cookieSecure, 300),
        );

        // Redirect straight to dashboard
        return reply.redirect(`/dashboard/${name}`);
      } catch (error: any) {
        // Handle duplicate service name error
        if (error.code === 11000) {
          return renderError(
            "A service with this name already exists for this account.",
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
