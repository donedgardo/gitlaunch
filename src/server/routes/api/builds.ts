import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { BuildService } from "../../../services/build/buildService";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { requireScope } from "../../middleware/apiKeyAuth";
import { DeploymentStatus } from "../../../services/service/deploymentStatus";

export type BuildsRoutesDependencies = {
  buildService: BuildService;
  repoRepo: RepositoryRepository;
};

type CreateBuildBody = {
  buildId: string;
};

type UpdateDeploymentStatusBody = {
  status: string;
};

type RepoIdParams = {
  repoId: string;
};

type BuildIdParams = RepoIdParams & {
  buildId: string;
};

type DeployParams = BuildIdParams & {
  env: string;
};

export function registerBuildsRoutes(
  app: FastifyInstance,
  deps: BuildsRoutesDependencies,
) {
  const { buildService, repoRepo } = deps;

  // POST /api/v1/repos/:repoId/builds - Create a new build
  app.post<{ Params: RepoIdParams; Body: CreateBuildBody }>(
    "/api/v1/repos/:repoId/builds",
    { preHandler: requireScope("builds:write") },
    async (
      request: FastifyRequest<{ Params: RepoIdParams; Body: CreateBuildBody }>,
      reply: FastifyReply,
    ) => {
      const { repoId } = request.params;
      const { buildId } = request.body;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(repoId)) {
        return reply.status(400).send({ error: "Invalid repository ID" });
      }

      const repositoryId = new ObjectId(repoId);

      // Validate repository belongs to account
      const repository = await repoRepo.findById(repositoryId);
      if (!repository) {
        return reply.status(404).send({ error: "Repository not found" });
      }
      if (repository.accountId.toString() !== accountId.toString()) {
        return reply
          .status(403)
          .send({ error: "Repository does not belong to this account" });
      }

      try {
        const build = await buildService.createBuild({
          accountId,
          repositoryId,
          buildId,
        });

        return reply.status(201).send({
          _id: build._id.toString(),
          accountId: build.accountId.toString(),
          repositoryId: build.repositoryId.toString(),
          buildId: build.buildId,
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

  // GET /api/v1/repos/:repoId/builds - List builds
  app.get<{ Params: RepoIdParams }>(
    "/api/v1/repos/:repoId/builds",
    { preHandler: requireScope("builds:read") },
    async (
      request: FastifyRequest<{ Params: RepoIdParams }>,
      reply: FastifyReply,
    ) => {
      const { repoId } = request.params;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(repoId)) {
        return reply.status(400).send({ error: "Invalid repository ID" });
      }

      const repositoryId = new ObjectId(repoId);

      // Validate repository belongs to account
      const repository = await repoRepo.findById(repositoryId);
      if (!repository) {
        return reply.status(404).send({ error: "Repository not found" });
      }
      if (repository.accountId.toString() !== accountId.toString()) {
        return reply
          .status(403)
          .send({ error: "Repository does not belong to this account" });
      }

      const builds = await buildService.getBuilds(accountId, repositoryId);

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

  // GET /api/v1/repos/:repoId/builds/:buildId - Get build details
  app.get<{ Params: BuildIdParams }>(
    "/api/v1/repos/:repoId/builds/:buildId",
    { preHandler: requireScope("builds:read") },
    async (
      request: FastifyRequest<{ Params: BuildIdParams }>,
      reply: FastifyReply,
    ) => {
      const { repoId, buildId } = request.params;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(repoId)) {
        return reply.status(400).send({ error: "Invalid repository ID" });
      }

      const repositoryId = new ObjectId(repoId);

      // Validate repository belongs to account
      const repository = await repoRepo.findById(repositoryId);
      if (!repository) {
        return reply.status(404).send({ error: "Repository not found" });
      }
      if (repository.accountId.toString() !== accountId.toString()) {
        return reply
          .status(403)
          .send({ error: "Repository does not belong to this account" });
      }

      const build = await buildService.getBuild(
        accountId,
        repositoryId,
        buildId,
      );

      if (!build) {
        return reply.status(404).send({ error: "Build not found" });
      }

      return reply.send({
        _id: build._id.toString(),
        accountId: build.accountId.toString(),
        repositoryId: build.repositoryId.toString(),
        buildId: build.buildId,
        deployments: build.deployments,
        deploymentLogs: build.deploymentLogs,
        createdAt: build.createdAt,
        updatedAt: build.updatedAt,
      });
    },
  );

  // POST /api/v1/repos/:repoId/builds/:buildId/deploy/:env - Trigger deployment
  app.post<{ Params: DeployParams }>(
    "/api/v1/repos/:repoId/builds/:buildId/deploy/:env",
    { preHandler: requireScope("deployments:write") },
    async (
      request: FastifyRequest<{ Params: DeployParams }>,
      reply: FastifyReply,
    ) => {
      const { repoId, buildId, env } = request.params;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(repoId)) {
        return reply.status(400).send({ error: "Invalid repository ID" });
      }

      const repositoryId = new ObjectId(repoId);

      try {
        const build = await buildService.updateDeploymentStatus({
          accountId,
          repositoryId,
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
        if (message === "Build not found") {
          return reply.status(404).send({ error: message });
        }
        return reply.status(500).send({ error: message });
      }
    },
  );

  // PATCH /api/v1/repos/:repoId/builds/:buildId/deploy/:env - Update deployment status
  app.patch<{ Params: DeployParams; Body: UpdateDeploymentStatusBody }>(
    "/api/v1/repos/:repoId/builds/:buildId/deploy/:env",
    { preHandler: requireScope("deployments:write") },
    async (
      request: FastifyRequest<{
        Params: DeployParams;
        Body: UpdateDeploymentStatusBody;
      }>,
      reply: FastifyReply,
    ) => {
      const { repoId, buildId, env } = request.params;
      const { status } = request.body;
      const accountId = request.apiKey!.accountId;

      if (!ObjectId.isValid(repoId)) {
        return reply.status(400).send({ error: "Invalid repository ID" });
      }

      const repositoryId = new ObjectId(repoId);

      // Validate status is a valid DeploymentStatus
      if (
        !Object.values(DeploymentStatus).includes(status as DeploymentStatus)
      ) {
        return reply.status(400).send({ error: "Invalid deployment status" });
      }

      try {
        const build = await buildService.updateDeploymentStatus({
          accountId,
          repositoryId,
          buildId,
          environment: env,
          status: status as DeploymentStatus,
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
            : "Failed to update deployment status";
        if (message === "Invalid environment") {
          return reply.status(400).send({ error: message });
        }
        if (message === "Build not found") {
          return reply.status(404).send({ error: message });
        }
        return reply.status(500).send({ error: message });
      }
    },
  );
}
