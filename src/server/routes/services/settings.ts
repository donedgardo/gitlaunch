import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { EnvironmentService } from "../../../services/environment/environmentService";

export type SettingsRoutesDeps = {
  serviceRepository: ServiceRepository;
  repositoryRepository: RepositoryRepository;
  environmentService: EnvironmentService;
};

export function registerSettingsRoutes(
  app: FastifyInstance,
  deps: SettingsRoutesDeps,
): void {
  const { serviceRepository, repositoryRepository, environmentService } = deps;

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
            workflowFile: service.workflowFile,
            eventType: service.eventType,
          },
          repository: repository
            ? {
                fullName: repository.githubFullName,
              }
            : null,
          environments,
          canDelete: environments.length > 1,
          services: serviceNames,
          activeService: service.name,
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /services/:serviceId/environments - Add environment (HTMX)
  app.post<{
    Params: { serviceId: string };
    Body: { name: string; displayName: string };
  }>(
    "/services/:serviceId/environments",
    async (
      request: FastifyRequest<{
        Params: { serviceId: string };
        Body: { name: string; displayName: string };
      }>,
      reply: FastifyReply,
    ) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;

      const { service, accountId } = result;
      const { name, displayName } = request.body;

      try {
        const updatedService = await environmentService.addEnvironment(
          accountId,
          service._id,
          { name, displayName },
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
    Body: { displayName?: string; order?: string };
  }>(
    "/services/:serviceId/environments/:name",
    async (
      request: FastifyRequest<{
        Params: { serviceId: string; name: string };
        Body: { displayName?: string; order?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;

      const { service, accountId } = result;
      const { name: envName } = request.params;
      const { displayName, order } = request.body;

      try {
        const updates: { displayName?: string; order?: number } = {};
        if (displayName !== undefined) {
          updates.displayName = displayName;
        }
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
    Body: { workflowFile: string; eventType: string };
  }>(
    "/services/:serviceId/workflow",
    async (
      request: FastifyRequest<{
        Params: { serviceId: string };
        Body: { workflowFile: string; eventType: string };
      }>,
      reply: FastifyReply,
    ) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;

      const { service } = result;
      const { workflowFile, eventType } = request.body;

      try {
        await serviceRepository.updateWorkflowConfiguration(service._id, {
          workflowFile: workflowFile || "deploy.yml",
          eventType: eventType || "deployment",
        });

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
}
