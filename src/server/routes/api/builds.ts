import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { BuildService } from "../../../services/build/buildService";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { requireScope } from "../../middleware/apiKeyAuth";
import { DeploymentStatus } from "../../../services/service/deploymentStatus";
import { AnalyticsService } from "../../../services/analytics/analytics";
import { machineActor } from "../../../services/analytics/actorIdentity";

export type BuildsRoutesDependencies = {
  buildService: BuildService;
  serviceRepo: ServiceRepository;
  planEnforcementService: PlanEnforcementService;
  analytics?: AnalyticsService;
};

type CreateBuildBody = {
  buildId: string;
  // Optional commit message; surfaced on the dashboard next to the SHA.
  message?: string;
};

type UpdateDeploymentStatusBody = {
  status: string;
};

type ServiceIdParams = {
  serviceId: string;
};

type BuildIdParams = ServiceIdParams & {
  buildId: string;
};

type DeployParams = BuildIdParams & {
  env: string;
};

export function registerBuildsRoutes(
  app: FastifyInstance,
  deps: BuildsRoutesDependencies,
) {
  const { buildService, serviceRepo, planEnforcementService, analytics } = deps;

  // POST /api/v1/services/:serviceId/builds - Create a new build
  app.post<{ Params: ServiceIdParams; Body: CreateBuildBody }>(
    "/api/v1/services/:serviceId/builds",
    { preHandler: requireScope("builds:write") },
    async (
      request: FastifyRequest<{
        Params: ServiceIdParams;
        Body: CreateBuildBody;
      }>,
      reply: FastifyReply,
    ) => {
      const { serviceId: serviceIdParam } = request.params;
      const { buildId, message } = request.body;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(serviceIdParam)) {
        return reply.status(400).send({ error: "Invalid service ID" });
      }

      const serviceId = new ObjectId(serviceIdParam);

      // Validate service belongs to account
      const service = await serviceRepo.findById(serviceId);
      if (!service) {
        return reply.status(404).send({ error: "Service not found" });
      }
      if (service.accountId.toString() !== accountId.toString()) {
        return reply
          .status(403)
          .send({ error: "Service does not belong to this account" });
      }

      // Check read-only state
      try {
        const accountState =
          await planEnforcementService.getAccountState(accountId);
        if (accountState.isReadOnly) {
          return reply.status(403).send({
            error:
              "Account is read-only. Please update your plan or payment method.",
          });
        }
      } catch {
        // Account not found — will be caught downstream
      }

      try {
        const build = await buildService.createBuild({
          accountId,
          serviceId,
          buildId,
          message,
        });
        analytics?.track(
          "build_reported",
          { serviceId, buildId },
          {
            accountId: accountId.toString(),
            distinctId: machineActor(request.apiKey!.apiKeyId.toString()),
          },
        );

        return reply.status(201).send({
          _id: build._id.toString(),
          accountId: build.accountId.toString(),
          serviceId: build.serviceId.toString(),
          buildId: build.buildId,
          message: build.message,
          deployments: build.deployments,
          createdAt: build.createdAt,
          updatedAt: build.updatedAt,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create build";
        return reply.status(400).send({ error: message });
      }
    },
  );

  // GET /api/v1/services/:serviceId/builds - List builds
  app.get<{ Params: ServiceIdParams }>(
    "/api/v1/services/:serviceId/builds",
    { preHandler: requireScope("builds:read") },
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

      // Validate service belongs to account
      const service = await serviceRepo.findById(serviceId);
      if (!service) {
        return reply.status(404).send({ error: "Service not found" });
      }
      if (service.accountId.toString() !== accountId.toString()) {
        return reply
          .status(403)
          .send({ error: "Service does not belong to this account" });
      }

      const builds = await buildService.getBuilds(accountId, serviceId);

      return reply.send({
        builds: builds.map((build) => ({
          _id: build._id.toString(),
          buildId: build.buildId,
          deployments: build.deployments,
          createdAt: build.createdAt,
          updatedAt: build.updatedAt,
        })),
      });
    },
  );

  // GET /api/v1/services/:serviceId/builds/:buildId - Get build details
  app.get<{ Params: BuildIdParams }>(
    "/api/v1/services/:serviceId/builds/:buildId",
    { preHandler: requireScope("builds:read") },
    async (
      request: FastifyRequest<{ Params: BuildIdParams }>,
      reply: FastifyReply,
    ) => {
      const { serviceId: serviceIdParam, buildId } = request.params;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(serviceIdParam)) {
        return reply.status(400).send({ error: "Invalid service ID" });
      }

      const serviceId = new ObjectId(serviceIdParam);

      // Validate service belongs to account
      const service = await serviceRepo.findById(serviceId);
      if (!service) {
        return reply.status(404).send({ error: "Service not found" });
      }
      if (service.accountId.toString() !== accountId.toString()) {
        return reply
          .status(403)
          .send({ error: "Service does not belong to this account" });
      }

      const build = await buildService.getBuild(accountId, serviceId, buildId);

      if (!build) {
        return reply.status(404).send({ error: "Build not found" });
      }

      return reply.send({
        _id: build._id.toString(),
        accountId: build.accountId.toString(),
        serviceId: build.serviceId.toString(),
        buildId: build.buildId,
        deployments: build.deployments,
        deploymentLogs: build.deploymentLogs,
        createdAt: build.createdAt,
        updatedAt: build.updatedAt,
      });
    },
  );

  // POST /api/v1/services/:serviceId/builds/:buildId/deploy/:env - Trigger deployment
  app.post<{ Params: DeployParams }>(
    "/api/v1/services/:serviceId/builds/:buildId/deploy/:env",
    { preHandler: requireScope("deployments:write") },
    async (
      request: FastifyRequest<{ Params: DeployParams }>,
      reply: FastifyReply,
    ) => {
      const { serviceId: serviceIdParam, buildId, env } = request.params;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(serviceIdParam)) {
        return reply.status(400).send({ error: "Invalid service ID" });
      }

      const serviceId = new ObjectId(serviceIdParam);

      // Check read-only state
      try {
        const accountState =
          await planEnforcementService.getAccountState(accountId);
        if (accountState.isReadOnly) {
          return reply.status(403).send({
            error:
              "Account is read-only. Please update your plan or payment method.",
          });
        }
      } catch {
        // Account not found — will be caught downstream
      }

      try {
        const build = await buildService.updateDeploymentStatus({
          accountId,
          serviceId,
          buildId,
          environment: env,
          status: DeploymentStatus.DISPATCHING,
        });

        return reply.send({
          _id: build._id.toString(),
          buildId: build.buildId,
          deployments: build.deployments,
          updatedAt: build.updatedAt,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to trigger deployment";
        if (message === "Invalid environment") {
          return reply.status(400).send({ error: message });
        }
        if (message === "Build not found" || message === "Service not found") {
          return reply.status(404).send({ error: message });
        }
        return reply.status(500).send({ error: message });
      }
    },
  );

  // PATCH /api/v1/services/:serviceId/builds/:buildId/deploy/:env - Update deployment status
  app.patch<{ Params: DeployParams; Body: UpdateDeploymentStatusBody }>(
    "/api/v1/services/:serviceId/builds/:buildId/deploy/:env",
    { preHandler: requireScope("deployments:write") },
    async (
      request: FastifyRequest<{
        Params: DeployParams;
        Body: UpdateDeploymentStatusBody;
      }>,
      reply: FastifyReply,
    ) => {
      const { serviceId: serviceIdParam, buildId, env } = request.params;
      const { status } = request.body;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(serviceIdParam)) {
        return reply.status(400).send({ error: "Invalid service ID" });
      }

      const serviceId = new ObjectId(serviceIdParam);

      // Validate status is a valid DeploymentStatus
      if (
        !Object.values(DeploymentStatus).includes(status as DeploymentStatus)
      ) {
        return reply.status(400).send({ error: "Invalid deployment status" });
      }

      // Check read-only state
      try {
        const accountState =
          await planEnforcementService.getAccountState(accountId);
        if (accountState.isReadOnly) {
          return reply.status(403).send({
            error:
              "Account is read-only. Please update your plan or payment method.",
          });
        }
      } catch {
        // Account not found — will be caught downstream
      }

      try {
        const build = await buildService.updateDeploymentStatus({
          accountId,
          serviceId,
          buildId,
          environment: env,
          status: status as DeploymentStatus,
        });
        analytics?.track(
          "deployment_status_updated",
          {
            serviceId,
            buildId,
            environment: env,
            status,
          },
          {
            accountId: accountId.toString(),
            distinctId: machineActor(request.apiKey!.apiKeyId.toString()),
          },
        );

        return reply.send({
          _id: build._id.toString(),
          buildId: build.buildId,
          deployments: build.deployments,
          updatedAt: build.updatedAt,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update deployment status";
        if (message === "Invalid environment") {
          return reply.status(400).send({ error: message });
        }
        if (message === "Build not found" || message === "Service not found") {
          return reply.status(404).send({ error: message });
        }
        return reply.status(500).send({ error: message });
      }
    },
  );
}
