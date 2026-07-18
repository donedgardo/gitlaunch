import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { BuildRepository, Build } from "../../repositories/buildRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { BuildService } from "../../services/build/buildService";
import { DeploymentStatus } from "../../services/service/deploymentStatus";
import { TrialService } from "../../services/billing/trialService";
import { PlanEnforcementService } from "../../services/billing/planEnforcementService";
import { AnalyticsService } from "../../services/analytics/analytics";

const DEFAULT_PAGE_SIZE = 20;

export type DashboardRoutesDeps = {
  serviceRepository: ServiceRepository;
  buildRepository: BuildRepository;
  repositoryRepository: RepositoryRepository;
  buildService: BuildService;
  trialService: TrialService;
  planEnforcementService: PlanEnforcementService;
  analytics?: AnalyticsService;
};

export default function (deps: DashboardRoutesDeps) {
  const {
    serviceRepository,
    buildRepository,
    repositoryRepository,
    buildService,
    trialService,
    planEnforcementService,
    analytics,
  } = deps;

  return function (server: FastifyInstance, opts: any, done: any) {
    server.addHook("preHandler", (req, res, done) => {
      // Check for both new session (JWT) and legacy user auth
      if (!req.session && !req.user) {
        return res.redirect("/");
      }
      done();
    });

    // Helper to convert Build to template-friendly format
    const formatBuildsForTemplate = (
      builds: Build[],
      environments: { name: string }[],
      serviceName: string,
      serviceId: string,
    ) => {
      return builds.map((build) => ({
        id: build.buildId,
        environments, // Include environments in each build for Handlebars partial scope
        serviceName, // Include serviceName in each build for Handlebars partial scope
        serviceId, // Include serviceId for deploy button URLs
        deployments: environments.reduce(
          (acc, env) => {
            acc[env.name] = build.deployments[env.name] || null;
            return acc;
          },
          {} as Record<string, string | null>,
        ),
      }));
    };

    // GET /dashboard - Show dashboard or redirect to first service
    const dashboardHandler = async (req: FastifyRequest, res: FastifyReply) => {
      const accountId = new ObjectId(req.session!.accountId);

      // Check and handle trial expiry (auto-downgrade if needed)
      const trialResult =
        await trialService.checkAndHandleTrialExpiry(accountId);
      if (trialResult.expired && trialResult.downgraded) {
        analytics?.track("trial_expired", { accountId: accountId.toString() });
      }

      // Get account state for trial/read-only banners
      const accountState =
        await planEnforcementService.getAccountState(accountId);

      // Load services from database
      const services = await serviceRepository.findByAccountId(accountId);

      // If no services, show empty dashboard
      if (services.length === 0) {
        return res.view(
          "dashboard",
          {
            services: [],
            activeService: null,
            environments: [],
            builds: [],
            trialDaysRemaining: accountState.trialDaysRemaining,
            isReadOnly: accountState.isReadOnly,
            gracePeriodDaysRemaining: accountState.gracePeriodDaysRemaining,
            paymentFailed: accountState.paymentFailed,
          },
          {
            layout: "/layouts/main.hbs",
          },
        );
      }

      // Redirect to first service
      return res.redirect(`/dashboard/${services[0].name}`);
    };

    server.get("/dashboard", dashboardHandler);
    server.get("/dashboard/", dashboardHandler);

    // GET /dashboard/:serviceName - Show specific service
    server.get<{
      Params: { serviceName: string };
      Querystring: { page?: number };
    }>(
      "/dashboard/:serviceName",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              page: { type: "integer", minimum: 1, default: 1 },
            },
          },
        },
      },
      async (
        req: FastifyRequest<{
          Params: { serviceName: string };
          Querystring: { page?: number };
        }>,
        reply: FastifyReply,
      ) => {
        const accountId = new ObjectId(req.session!.accountId);
        const { serviceName } = req.params;
        const page = req.query.page ?? 1;

        // Check and handle trial expiry (auto-downgrade if needed)
        const trialResult2 =
          await trialService.checkAndHandleTrialExpiry(accountId);
        if (trialResult2.expired && trialResult2.downgraded) {
          analytics?.track("trial_expired", {
            accountId: accountId.toString(),
          });
        }

        // Get account state for trial/read-only banners
        const accountState =
          await planEnforcementService.getAccountState(accountId);

        // Load all services for navigation
        const services = await serviceRepository.findByAccountId(accountId);
        const serviceNames = services.map((s) => s.name);

        // Find the active service
        const activeService = services.find((s) => s.name === serviceName);
        if (!activeService) {
          // Service not found, redirect to dashboard
          return reply.redirect("/dashboard");
        }

        // Get environment names, sorted by order
        const environments = [...activeService.environments]
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((e) => ({
            name: e.name,
          }));

        // Commit-link source: prefer the service's own repoUrl; fall back to
        // the connected repository's GitHub URL for legacy GitHub services that
        // predate repoUrl (no migration needed).
        const dispatchRepoId =
          activeService.deployment.provider === "github"
            ? activeService.deployment.repositoryId
            : null;
        const repository = dispatchRepoId
          ? await repositoryRepository.findById(dispatchRepoId)
          : null;
        const repoUrl =
          activeService.repoUrl ||
          (repository?.githubFullName
            ? `https://github.com/${repository.githubFullName}`
            : "");

        // Load paginated builds for this service
        const { builds, total, hasMore } = await buildRepository.findPaginated(
          accountId,
          activeService._id,
          page,
          DEFAULT_PAGE_SIZE,
        );
        const formattedBuilds = formatBuildsForTemplate(
          builds,
          environments,
          serviceName,
          activeService._id.toString(),
        );

        // Compute pagination metadata
        const currentPage = page;
        const totalPages = Math.ceil(total / DEFAULT_PAGE_SIZE);
        const hasPrev = page > 1;

        const pagination = {
          currentPage,
          totalPages,
          hasMore,
          hasPrev,
          serviceName,
        };

        // Check if we need to show deployment setup guide
        // Show guide when builds exist but workflow hasn't been configured yet
        // workflowConfigured may be undefined for services created before this feature
        // Use total instead of builds.length since builds may be empty on later pages
        const needsDeploymentSetup =
          total > 0 && activeService.workflowConfigured !== true;

        // Handle HTMX partial request - no layout wrapper needed
        if (req.headers["hx-request"]) {
          return reply.view(
            "partials/htmxDashboard",
            {
              services: serviceNames,
              activeService: serviceName,
              serviceId: activeService._id.toString(),
              serviceName: serviceName,
              environments,
              builds: formattedBuilds,
              repoUrl,
              needsDeploymentSetup,
              pagination,
              trialDaysRemaining: accountState.trialDaysRemaining,
              isReadOnly: accountState.isReadOnly,
              gracePeriodDaysRemaining: accountState.gracePeriodDaysRemaining,
              paymentFailed: accountState.paymentFailed,
            },
            { layout: "" },
          );
        }

        // Check for new API key cookie (set after service creation)
        const apiKeyCookie = req.cookies.new_api_key;
        const newApiKey = apiKeyCookie
          ? reply.unsignCookie(apiKeyCookie).value
          : null;
        if (newApiKey) {
          reply.clearCookie("new_api_key", { path: "/" });
        }

        // Full page render
        return reply.view(
          "dashboard",
          {
            services: serviceNames,
            activeService: serviceName,
            serviceId: activeService._id.toString(),
            environments,
            builds: formattedBuilds,
            repoUrl,
            needsDeploymentSetup,
            newApiKey,
            showSimulateBuild: process.env.USE_FAKE_GITHUB === "true",
            pagination,
            trialDaysRemaining: accountState.trialDaysRemaining,
            isReadOnly: accountState.isReadOnly,
            gracePeriodDaysRemaining: accountState.gracePeriodDaysRemaining,
            paymentFailed: accountState.paymentFailed,
          },
          {
            layout: "/layouts/main.hbs",
          },
        );
      },
    );

    // PATCH /services/:serviceId/builds/:buildId/deploy/:env - Trigger deployment from dashboard
    server.patch<{
      Params: { serviceId: string; buildId: string; env: string };
    }>(
      "/services/:serviceId/builds/:buildId/deploy/:env",
      async (
        req: FastifyRequest<{
          Params: { serviceId: string; buildId: string; env: string };
        }>,
        reply: FastifyReply,
      ) => {
        const accountId = new ObjectId(req.session!.accountId);
        const { serviceId, buildId, env } = req.params;

        // Validate serviceId format
        if (!ObjectId.isValid(serviceId)) {
          return reply.status(400).send({ error: "Invalid service ID" });
        }

        // Check read-only state
        try {
          const accountState =
            await planEnforcementService.getAccountState(accountId);
          if (accountState.isReadOnly) {
            return reply.status(403).send({
              error:
                "Account is read-only. Please update your plan or payment method to deploy.",
            });
          }
        } catch {
          // Account not found — will be caught by ownership check below
        }

        // Find the service by ID and verify ownership
        const service = await serviceRepository.findByAccountAndId(
          accountId,
          new ObjectId(serviceId),
        );
        if (!service) {
          return reply.status(404).send({ error: "Service not found" });
        }

        try {
          const build = await buildService.updateDeploymentStatus({
            accountId,
            serviceId: service._id,
            buildId,
            environment: env,
            status: DeploymentStatus.DISPATCHING,
          });
          analytics?.track("deployment_triggered", {
            serviceName: service.name,
            buildId,
            environment: env,
          });

          // Return the partial for HTMX swap
          return reply.view(
            "/partials/buildEnvironmentAction.hbs",
            {
              buildId,
              status: build.deployments[env],
              env,
              serviceName: service.name,
              serviceId,
              isOobSwap: true,
            },
            { layout: "" },
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to trigger deployment";
          if (
            message === "Invalid environment" ||
            message === "Invalid deployment status"
          ) {
            return reply.status(400).send({ error: message });
          }
          if (
            message === "Build not found" ||
            message === "Service not found"
          ) {
            return reply.status(404).send({ error: message });
          }
          return reply.status(500).send({ error: message });
        }
      },
    );

    // DELETE /services/:serviceId/builds/:buildId/deploy/:env - Cancel deployment
    server.delete<{
      Params: { serviceId: string; buildId: string; env: string };
    }>(
      "/services/:serviceId/builds/:buildId/deploy/:env",
      async (
        req: FastifyRequest<{
          Params: { serviceId: string; buildId: string; env: string };
        }>,
        reply: FastifyReply,
      ) => {
        const accountId = new ObjectId(req.session!.accountId);
        const { serviceId, buildId, env } = req.params;

        // Validate serviceId format
        if (!ObjectId.isValid(serviceId)) {
          return reply.status(400).send({ error: "Invalid service ID" });
        }

        // Find the service by ID and verify ownership
        const service = await serviceRepository.findByAccountAndId(
          accountId,
          new ObjectId(serviceId),
        );
        if (!service) {
          return reply.status(404).send({ error: "Service not found" });
        }

        // Get current build status
        const build = await buildRepository.findByBuildId(
          accountId,
          service._id,
          buildId,
        );
        if (!build) {
          return reply.status(404).send({ error: "Build not found" });
        }

        const currentStatus = build.deployments[env];

        // Only allow cancellation of dispatching or deploying statuses
        if (
          currentStatus !== DeploymentStatus.DISPATCHING &&
          currentStatus !== DeploymentStatus.DEPLOYING
        ) {
          return reply
            .status(400)
            .send({ error: "Cannot cancel: deployment is not in progress" });
        }

        try {
          const updatedBuild = await buildService.updateDeploymentStatus({
            accountId,
            serviceId: service._id,
            buildId,
            environment: env,
            status: DeploymentStatus.CANCELLED,
          });

          // Return the partial for HTMX swap
          return reply.view(
            "/partials/buildEnvironmentAction.hbs",
            {
              buildId,
              status: updatedBuild.deployments[env],
              env,
              serviceName: service.name,
              serviceId,
              isOobSwap: true,
            },
            { layout: "" },
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to cancel deployment";
          return reply.status(500).send({ error: message });
        }
      },
    );

    done();
  };
}
