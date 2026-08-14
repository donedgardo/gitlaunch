import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { BuildRepository, Build } from "../../repositories/buildRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { AccountRepository } from "../../repositories/accountRepository";
import { BuildService } from "../../services/build/buildService";
import { DeploymentStatus } from "../../services/service/deploymentStatus";
import { TrialService } from "../../services/billing/trialService";
import { PlanEnforcementService } from "../../services/billing/planEnforcementService";
import { AnalyticsService } from "../../services/analytics/analytics";
import { FlagServiceI } from "../../services/flag/flagService";
import {
  summarizeEnvironmentFlags,
  EnvFlagSummary,
} from "../../services/flag/flagBoardSummary";
import { DoraMetricsService } from "../../services/dora/doraMetricsService";
import { toFourKeysView, FourKeysView } from "../../services/dora/fourKeysView";

const DEFAULT_PAGE_SIZE = 20;

/**
 * How far back the board's delivery metrics look.
 *
 * Long enough that a weekly-shipping team has something to show, short enough
 * that the numbers describe how the team works now rather than last quarter.
 */
const DORA_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type DoraPanel = {
  windowDays: number;
  environments: Array<{ name: string } & FourKeysView>;
};

export type DashboardRoutesDeps = {
  publicUrl: string;
  buildSimulationEnabled: boolean;
  serviceRepository: ServiceRepository;
  buildRepository: BuildRepository;
  repositoryRepository: RepositoryRepository;
  accountRepository: AccountRepository;
  buildService: BuildService;
  trialService: TrialService;
  planEnforcementService: PlanEnforcementService;
  analytics?: AnalyticsService;
  // Optional: when absent the board renders exactly as before, without flag
  // state. Flags enrich the board; they are never required to read it.
  flagService?: FlagServiceI;
  // Optional on the same terms: the delivery metrics panel is an addition to
  // the board, never a prerequisite for seeing what is deployed.
  doraMetricsService?: DoraMetricsService;
};

export default function (deps: DashboardRoutesDeps) {
  const {
    publicUrl,
    buildSimulationEnabled,
    serviceRepository,
    buildRepository,
    repositoryRepository,
    accountRepository,
    buildService,
    trialService,
    planEnforcementService,
    analytics,
    flagService,
    doraMetricsService,
  } = deps;

  // Flag state for each environment column of the release board.
  //
  // Deliberately fail-soft: the board's core job is showing what's deployed,
  // and a flag lookup problem must never take that away. On any failure the
  // board simply renders without flag state, as it did before flags existed.
  const loadEnvironmentFlags = async (
    accountId: ObjectId,
    serviceId: ObjectId,
    environmentNames: string[],
  ): Promise<EnvFlagSummary[] | null> => {
    if (!flagService) return null;
    try {
      const flags = await flagService.listFlags(accountId, serviceId);
      return summarizeEnvironmentFlags(flags, environmentNames);
    } catch {
      return null;
    }
  };

  /**
   * The four keys for each environment column, ready to render.
   *
   * Fail-soft for the same reason as flags: a metrics problem must never cost
   * the customer the answer to "what is live". Returns null — meaning "render
   * no panel" — both on failure and when nothing has ever deployed, since a
   * panel of blanks on a brand-new service is noise, not information.
   */
  const loadDeliveryMetrics = async (
    accountId: ObjectId,
    serviceId: ObjectId,
    environmentNames: string[],
  ): Promise<DoraPanel | null> => {
    if (!doraMetricsService) return null;
    try {
      const to = new Date();
      const from = new Date(to.getTime() - DORA_WINDOW_DAYS * DAY_MS);
      const keys = await doraMetricsService.forEnvironments(
        accountId,
        serviceId,
        environmentNames,
        { from, to },
      );

      const environments = environmentNames.map((name) => ({
        name,
        ...toFourKeysView(keys[name]),
      }));

      if (!environments.some((e) => e.hasData)) {
        return null;
      }
      return { windowDays: DORA_WINDOW_DAYS, environments };
    } catch {
      return null;
    }
  };

  return function (server: FastifyInstance, opts: any, done: any) {
    server.addHook("preHandler", async (req, res) => {
      // Check for both new session (JWT) and legacy user auth
      if (!req.session && !req.user) {
        return res.redirect("/");
      }

      // A validly-signed session can still point at an account that no longer
      // exists (e.g. after a local DB reset). Treat that as logged out: clear
      // the stale cookie and send them home instead of rendering a broken
      // dashboard for a phantom account.
      if (req.session) {
        const account = await accountRepository.findById(
          new ObjectId(req.session.accountId),
        );
        if (!account) {
          res.clearCookie("session", { path: "/" });
          return res.redirect("/");
        }
      }
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
        message: build.message, // Commit message shown next to the SHA
        createdAt: build.createdAt, // Report time, rendered as "how long ago"
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
        // When it went live per environment, rendered as "3d ago" next to Live
        deployedAt: environments.reduce(
          (acc, env) => {
            acc[env.name] = build.deployedAt?.[env.name] || null;
            return acc;
          },
          {} as Record<string, Date | null>,
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

        // What's deployed is only half of "what's live" — the other half is
        // what's switched on inside it. Each environment column carries its own
        // flag state so both answers sit on the same screen.
        const flagSummaries = await loadEnvironmentFlags(
          accountId,
          activeService._id,
          environments.map((e) => e.name),
        );
        const boardEnvironments = environments.map((env, index) => ({
          ...env,
          flags: flagSummaries?.[index] ?? null,
        }));

        // What is live and what is switched on inside it, plus how well the
        // team gets it there. The four keys sit above the board rather than
        // in a separate report, so the numbers stay attached to the delivery
        // they describe.
        const doraMetrics = await loadDeliveryMetrics(
          accountId,
          activeService._id,
          environments.map((e) => e.name),
        );

        // Commit-link source: prefer the service's own repoUrl; fall back to
        // the connected repository's GitHub URL for legacy GitHub services that
        // predate repoUrl (no migration needed).
        const dispatchRepoId =
          activeService.deployment?.provider === "github"
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

        // Report-only (deployment not configured) services show status without
        // Deploy/Redeploy controls.
        const canDispatch = activeService.deployment != null;
        // Drives the provider-appropriate "report your first build" guide on the
        // empty dashboard (GitHub Actions / Jenkins / raw). Report-only services
        // default to the GitHub guide.
        const provider = activeService.deployment?.provider ?? "github";
        const apiUrl = publicUrl;

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

        // The inline deploy-workflow guide is GitHub-specific (add deploy.yml +
        // secrets), so only show it once a GitHub deployment is chosen but its
        // workflow file isn't configured yet. Report-only, Jenkins, and raw
        // services get the "finish deploy setup" CTA instead (via canDispatch).
        const needsDeploymentSetup =
          total > 0 &&
          activeService.deployment?.provider === "github" &&
          activeService.workflowConfigured !== true;

        // Handle HTMX partial request - no layout wrapper needed
        if (req.headers["hx-request"]) {
          return reply.view(
            "partials/htmxDashboard",
            {
              services: serviceNames,
              activeService: serviceName,
              serviceId: activeService._id.toString(),
              serviceName: serviceName,
              environments: boardEnvironments,
              doraMetrics,
              builds: formattedBuilds,
              repoUrl,
              canDispatch,
              provider,
              apiUrl,
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
            environments: boardEnvironments,
            doraMetrics,
            builds: formattedBuilds,
            repoUrl,
            canDispatch,
            provider,
            apiUrl,
            needsDeploymentSetup,
            newApiKey,
            showSimulateBuild: buildSimulationEnabled,
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
          analytics?.track(
            "deployment_triggered",
            {
              serviceName: service.name,
              buildId,
              environment: env,
            },
            {
              accountId: accountId.toString(),
              distinctId: req.session!.userId,
            },
          );

          // Return the partial for HTMX swap
          return reply.view(
            "/partials/buildEnvironmentAction.hbs",
            {
              buildId,
              status: build.deployments[env],
              deployedAt: build.deployedAt?.[env],
              env,
              serviceName: service.name,
              serviceId,
              canDispatch: service.deployment != null,
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
          // Unexpected failure (e.g. the CI provider rejected the dispatch) —
          // log it so it is diagnosable beyond the edge's 500.
          req.log.error(
            { err: error, serviceId, buildId, env },
            "Failed to dispatch deployment",
          );
          // Generic on purpose — see the note in routes/api/builds.ts.
          return reply
            .status(500)
            .send({ error: "Failed to trigger deployment" });
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
              deployedAt: updatedBuild.deployedAt?.[env],
              env,
              serviceName: service.name,
              serviceId,
              canDispatch: service.deployment != null,
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
