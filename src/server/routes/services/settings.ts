import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { EnvironmentService } from "../../../services/environment/environmentService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { AnalyticsService } from "../../../services/analytics/analytics";

export type SettingsRoutesDeps = {
  serviceRepository: ServiceRepository;
  repositoryRepository: RepositoryRepository;
  environmentService: EnvironmentService;
  planEnforcementService: PlanEnforcementService;
  analytics?: AnalyticsService;
};

export function registerSettingsRoutes(
  app: FastifyInstance,
  deps: SettingsRoutesDeps,
): void {
  const {
    serviceRepository,
    repositoryRepository,
    environmentService,
    planEnforcementService,
    analytics,
  } = deps;

  // Helper to load service with ownership verification
  async function loadServiceWithAuth(
    request: FastifyRequest<{ Params: { serviceId: string } }>,
    reply: FastifyReply,
  ) {
    if (!request.session) {
      reply.redirect("/auth/github");
      return null;
    }

    const accountId = new ObjectId(request.session.accountId);
    const { serviceId } = request.params;

    let serviceObjectId: ObjectId;
    try {
      serviceObjectId = new ObjectId(serviceId);
    } catch {
      reply.status(400).send("Invalid service ID");
      return null;
    }

    const service = await serviceRepository.findByAccountAndId(
      accountId,
      serviceObjectId,
    );
    if (!service) {
      reply.status(404).send("Service not found");
      return null;
    }

    return { service, accountId };
  }

  // GET /services/:serviceId/settings - Render settings page
  app.get<{ Params: { serviceId: string } }>(
    "/services/:serviceId/settings",
    async (
      request: FastifyRequest<{ Params: { serviceId: string } }>,
      reply: FastifyReply,
    ) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;

      const { service, accountId } = result;

      // Get repository info
      const repository = await repositoryRepository.findById(
        service.repositoryId,
      );

      // Get all services for navigation
      const services = await serviceRepository.findByAccountId(accountId);
      const serviceNames = services.map((s) => s.name);

      // Sort environments by order
      const environments = [...service.environments].sort(
        (a, b) => a.order - b.order,
      );

      return reply.view(
        "services/settings",
        {
          title: `${service.name} Settings`,
          service: {
            id: service._id.toString(),
            name: service.name,
            workflowFile:
              service.deployment.provider === "github"
                ? service.deployment.workflowFile
                : "",
            ciProvider: service.deployment.provider,
            isJenkins: service.deployment.provider === "jenkins",
            jobName:
              service.deployment.provider === "jenkins"
                ? service.deployment.jobName
                : null,
          },
          repository: repository
            ? {
                fullName: repository.githubFullName,
              }
            : null,
          environments,
          apiUrl: process.env.PUBLIC_URL,
          firstEnv: environments[0]?.name ?? "staging",
          canDelete: environments.length > 1,
          services: serviceNames,
          activeService: service.name,
          serviceId: service._id.toString(),
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /services/:serviceId/environments - Add environment (HTMX)
  app.post<{
    Params: { serviceId: string };
    Body: { name: string };
  }>(
    "/services/:serviceId/environments",
    async (
      request: FastifyRequest<{
        Params: { serviceId: string };
        Body: { name: string };
      }>,
      reply: FastifyReply,
    ) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;

      const { service, accountId } = result;
      const { name } = request.body;

      // Check environment limit
      const canAdd = await planEnforcementService.canAddEnvironment(
        accountId,
        service._id,
      );
      if (!canAdd.allowed) {
        const environments = [...service.environments].sort(
          (a, b) => a.order - b.order,
        );
        return reply.view("partials/environmentList", {
          environments,
          canDelete: environments.length > 1,
          serviceId: service._id.toString(),
          error: canAdd.reason,
        });
      }

      try {
        const updatedService = await environmentService.addEnvironment(
          accountId,
          service._id,
          { name },
        );

        // Sort environments by order
        const environments = [...updatedService.environments].sort(
          (a, b) => a.order - b.order,
        );

        return reply.view("partials/environmentList", {
          environments,
          canDelete: environments.length > 1,
          serviceId: service._id.toString(),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to add environment";

        // Return 200 so HTMX swaps the content (HTMX doesn't swap on 4xx by default)
        // The error is displayed in the partial template
        return reply.view("partials/environmentList", {
          environments: [...service.environments].sort(
            (a, b) => a.order - b.order,
          ),
          canDelete: service.environments.length > 1,
          serviceId: service._id.toString(),
          error: message,
        });
      }
    },
  );

  // PATCH /services/:serviceId/environments/:name - Update environment (HTMX)
  app.patch<{
    Params: { serviceId: string; name: string };
    Body: { order?: string };
  }>(
    "/services/:serviceId/environments/:name",
    async (
      request: FastifyRequest<{
        Params: { serviceId: string; name: string };
        Body: { order?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;

      const { service, accountId } = result;
      const { name: envName } = request.params;
      const { order } = request.body;

      try {
        const updates: { order?: number } = {};
        if (order !== undefined) {
          updates.order = parseInt(order, 10);
        }

        const updatedService = await environmentService.updateEnvironment(
          accountId,
          service._id,
          envName,
          updates,
        );

        // Sort environments by order
        const environments = [...updatedService.environments].sort(
          (a, b) => a.order - b.order,
        );

        return reply.view("partials/environmentList", {
          environments,
          canDelete: environments.length > 1,
          serviceId: service._id.toString(),
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update environment";

        return reply.status(400).view("partials/environmentList", {
          environments: [...service.environments].sort(
            (a, b) => a.order - b.order,
          ),
          canDelete: service.environments.length > 1,
          serviceId: service._id.toString(),
          error: message,
        });
      }
    },
  );

  // DELETE /services/:serviceId/environments/:name - Delete environment (HTMX)
  app.delete<{
    Params: { serviceId: string; name: string };
  }>(
    "/services/:serviceId/environments/:name",
    async (
      request: FastifyRequest<{
        Params: { serviceId: string; name: string };
      }>,
      reply: FastifyReply,
    ) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;

      const { service, accountId } = result;
      const { name: envName } = request.params;

      try {
        const updatedService = await environmentService.removeEnvironment(
          accountId,
          service._id,
          envName,
        );

        // Sort environments by order
        const environments = [...updatedService.environments].sort(
          (a, b) => a.order - b.order,
        );

        return reply.view("partials/environmentList", {
          environments,
          canDelete: environments.length > 1,
          serviceId: service._id.toString(),
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to delete environment";

        return reply.status(400).view("partials/environmentList", {
          environments: [...service.environments].sort(
            (a, b) => a.order - b.order,
          ),
          canDelete: service.environments.length > 1,
          serviceId: service._id.toString(),
          error: message,
        });
      }
    },
  );

  // PATCH /services/:serviceId/workflow - Update workflow configuration (HTMX)
  app.patch<{
    Params: { serviceId: string };
    Body: { workflowFile: string };
  }>(
    "/services/:serviceId/workflow",
    async (
      request: FastifyRequest<{
        Params: { serviceId: string };
        Body: { workflowFile: string };
      }>,
      reply: FastifyReply,
    ) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;

      const { service } = result;
      const { workflowFile } = request.body;

      try {
        await serviceRepository.updateWorkflowConfiguration(service._id, {
          workflowFile: workflowFile || "deploy.yml",
        });
        analytics?.track("workflow_configured", {
          serviceId: service._id.toString(),
          workflowFile: workflowFile || "deploy.yml",
        });

        // If from setup wizard, redirect to dashboard
        const currentUrl = request.headers["hx-current-url"] as string;
        if (currentUrl && currentUrl.includes("/dashboard/")) {
          const match = currentUrl.match(/\/dashboard\/([^/]+)/);
          const svcName = match ? match[1] : "";
          reply.header("HX-Redirect", `/dashboard/${svcName}`);
          return reply.status(200).send();
        }

        // Return success response with HX-Trigger for toast notification
        reply.header(
          "HX-Trigger",
          JSON.stringify({
            showToast: { message: "Workflow settings saved", type: "success" },
          }),
        );
        return reply.status(200).send();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update workflow configuration";

        reply.header(
          "HX-Trigger",
          JSON.stringify({
            showToast: { message, type: "error" },
          }),
        );
        return reply.status(400).send();
      }
    },
  );

  // PATCH /services/:serviceId/provider - Choose CI provider (HTMX)
  app.patch<{
    Params: { serviceId: string };
    Body: { ciProvider: string; jobName?: string };
  }>(
    "/services/:serviceId/provider",
    async (
      request: FastifyRequest<{
        Params: { serviceId: string };
        Body: { ciProvider: string; jobName?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;

      const { service, accountId } = result;
      const ciProvider = request.body.ciProvider;
      const jobName = request.body.jobName?.trim() || null;

      function toastError(message: string) {
        reply.header(
          "HX-Trigger",
          JSON.stringify({ showToast: { message, type: "error" } }),
        );
        return reply.status(400).send();
      }

      if (ciProvider !== "github" && ciProvider !== "jenkins") {
        return toastError("Unknown CI provider");
      }
      if (ciProvider === "jenkins" && !jobName) {
        return toastError("A Jenkins job name is required");
      }

      await serviceRepository.setProvider(accountId, service._id, {
        ciProvider,
        jobName: ciProvider === "jenkins" ? jobName : null,
      });
      analytics?.track("service_provider_updated", {
        serviceId: service._id.toString(),
        ciProvider,
      });

      reply.header(
        "HX-Trigger",
        JSON.stringify({
          showToast: { message: "CI provider saved", type: "success" },
        }),
      );
      return reply.status(200).send();
    },
  );

  // DELETE /services/:serviceId - Delete a service (HTMX)
  app.delete<{
    Params: { serviceId: string };
  }>(
    "/services/:serviceId",
    async (
      request: FastifyRequest<{
        Params: { serviceId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;

      const { service } = result;

      const deleted = await serviceRepository.delete(service._id);

      if (!deleted) {
        return reply.status(500).send("Failed to delete service");
      }

      // Redirect to dashboard after deletion
      reply.header("HX-Redirect", "/dashboard");
      return reply.status(200).send();
    },
  );
}
