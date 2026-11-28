import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { AccountRepository } from "../../../repositories/accountRepository";
import { AccountLimits } from "../../../services/limits/accountPolicy";
import { GitHubRepo } from "../../../services/github/githubAppService";
import { AnalyticsService } from "../../../services/analytics/analytics";
import {
  requireScope,
  requireAllEnvironments,
} from "../../middleware/apiKeyAuth";

/**
 * Only the slice of GitHubAppService this route needs, so tests can supply a
 * stub without standing up the whole App client.
 */
export type InstallationRepoLister = {
  listInstallationRepos(accountId: ObjectId): Promise<GitHubRepo[]>;
};

export type DeploymentRoutesDependencies = {
  serviceRepository: ServiceRepository;
  repositoryRepository: RepositoryRepository;
  accountRepository: AccountRepository;
  planEnforcementService: AccountLimits;
  gitHubAppService: InstallationRepoLister;
  analytics?: AnalyticsService;
};

type ServiceIdParams = { serviceId: string };

type DeploymentBody = {
  provider?: string;
  /** github: "owner/repo" as the agent knows it from the checkout. */
  repository?: string;
  workflowFile?: string;
  jobName?: string;
  endpointUrl?: string;
};

// The workflow file is interpolated straight into a GitHub API path
// (…/actions/workflows/<file>/dispatches), so it must be a bare filename.
const WORKFLOW_FILE = /^[A-Za-z0-9._-]+\.ya?ml$/;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function registerDeploymentRoutes(
  app: FastifyInstance,
  deps: DeploymentRoutesDependencies,
) {
  const {
    serviceRepository,
    repositoryRepository,
    accountRepository,
    planEnforcementService,
    gitHubAppService,
    analytics,
  } = deps;

  // POST /api/v1/services/:serviceId/deployment
  //
  // Binds a service to the thing that actually runs its deploys. Exists so an
  // onboarding agent can finish setup from the repo it is already sitting in,
  // instead of sending the user back to the browser. The one step that still
  // needs a browser is installing the GitHub App, which is a consent screen on
  // github.com with no API equivalent — this returns 409 with that instruction
  // rather than failing obscurely.
  app.post<{ Params: ServiceIdParams; Body: DeploymentBody }>(
    "/api/v1/services/:serviceId/deployment",
    {
      preHandler: [requireScope("services:write"), requireAllEnvironments()],
    },
    async (
      request: FastifyRequest<{
        Params: ServiceIdParams;
        Body: DeploymentBody;
      }>,
      reply: FastifyReply,
    ) => {
      const accountId = request.apiKey!.accountId;
      const { serviceId: serviceIdParam } = request.params;

      if (!ObjectId.isValid(serviceIdParam)) {
        return reply.status(400).send({ error: "Invalid service ID" });
      }

      const service = await serviceRepository.findByAccountAndId(
        accountId,
        new ObjectId(serviceIdParam),
      );
      if (!service) {
        return reply.status(404).send({ error: "Service not found" });
      }

      const body = request.body ?? {};
      const provider = body.provider?.trim();

      if (provider === "github") {
        const fullName = body.repository?.trim() || "";
        if (!fullName.includes("/")) {
          return reply
            .status(400)
            .send({ error: "repository must be in owner/repo form" });
        }

        const workflowFile = body.workflowFile?.trim() || "deploy.yml";
        if (!WORKFLOW_FILE.test(workflowFile)) {
          return reply.status(400).send({
            error: "workflowFile must be a bare .yml filename, e.g. deploy.yml",
          });
        }

        const account = await accountRepository.findById(accountId);
        if (!account?.githubConnection) {
          return reply.status(409).send({
            error:
              "This account has no GitHub App installation. Install the GitLaunch GitHub App, then retry.",
            installRequired: true,
          });
        }

        // Already registered? Match case-insensitively — GitHub treats repo
        // names that way and the agent may have it in either case.
        const existing = (
          await repositoryRepository.findByAccountId(accountId)
        ).find(
          (candidate) =>
            candidate.githubFullName.toLowerCase() === fullName.toLowerCase(),
        );

        let repositoryId: ObjectId;
        if (existing) {
          repositoryId = existing._id;
        } else {
          let visible: GitHubRepo[];
          try {
            visible = await gitHubAppService.listInstallationRepos(accountId);
          } catch {
            return reply.status(409).send({
              error:
                "Could not read the GitHub App installation. Reinstall the GitLaunch GitHub App, then retry.",
              installRequired: true,
            });
          }

          const match = visible.find(
            (candidate) =>
              candidate.full_name.toLowerCase() === fullName.toLowerCase(),
          );
          if (!match) {
            return reply.status(404).send({
              error: `${fullName} is not accessible by the GitLaunch GitHub App installation. Grant it access to this repository, then retry.`,
            });
          }

          // Plan gates before writing anything, so a refusal leaves no trace.
          const usage = await planEnforcementService.getUsage(accountId);
          if (usage.repositories.current + 1 > usage.repositories.limit) {
            return reply.status(403).send({
              error: `Repository limit reached (${usage.repositories.current}/${usage.repositories.limit}).`,
              upgradeRequired: true,
            });
          }
          if (match.private) {
            const canAddPrivate =
              await planEnforcementService.canAddPrivateRepository(accountId);
            if (!canAddPrivate.allowed) {
              return reply.status(403).send({
                error:
                  canAddPrivate.reason ??
                  "Private repositories require an upgrade.",
                upgradeRequired: true,
              });
            }
          }

          const created = await repositoryRepository.create({
            accountId,
            githubRepoId: match.id,
            githubFullName: match.full_name,
            githubOwner: match.owner?.login ?? match.full_name.split("/")[0],
            githubRepoName: match.name ?? match.full_name.split("/")[1],
            isPrivate: match.private,
            defaultBranch: match.default_branch,
          });
          repositoryId = created._id;
        }

        await serviceRepository.setDeployment(accountId, service._id, {
          provider: "github",
          repositoryId,
          workflowFile,
        });
        analytics?.track("deployment_configured", {
          serviceId: service._id.toString(),
          provider: "github",
        });
        return reply.send({
          provider: "github",
          repository: fullName,
          workflowFile,
        });
      }

      if (provider === "jenkins") {
        const jobName = body.jobName?.trim() || "";
        if (!jobName) {
          return reply.status(400).send({ error: "jobName is required" });
        }

        const account = await accountRepository.findById(accountId);
        if (!account?.jenkinsConnection) {
          return reply.status(409).send({
            error:
              "This account has no Jenkins server connected. Connect one in settings, then retry.",
          });
        }

        await serviceRepository.setDeployment(accountId, service._id, {
          provider: "jenkins",
          jobName,
        });
        analytics?.track("deployment_configured", {
          serviceId: service._id.toString(),
          provider: "jenkins",
        });
        return reply.send({ provider: "jenkins", jobName });
      }

      if (provider === "raw") {
        const endpointUrl = body.endpointUrl?.trim() || "";
        if (!isHttpUrl(endpointUrl)) {
          return reply
            .status(400)
            .send({ error: "endpointUrl must be an http or https URL" });
        }

        await serviceRepository.setDeployment(accountId, service._id, {
          provider: "raw",
          endpointUrl,
        });
        analytics?.track("deployment_configured", {
          serviceId: service._id.toString(),
          provider: "raw",
        });
        return reply.send({ provider: "raw", endpointUrl });
      }

      return reply
        .status(400)
        .send({ error: "provider must be one of: github, jenkins, raw" });
    },
  );
}
