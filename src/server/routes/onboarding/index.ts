import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import {
  AccountRepository,
  Plan,
} from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { UserRepository } from "../../../repositories/userRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { GitHubAppService } from "../../../services/github/githubAppService";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { TrialService } from "../../../services/billing/trialService";
import { AnalyticsService } from "../../../services/analytics/analytics";

export type OnboardingRoutesDeps = {
  accountRepository: AccountRepository;
  repositoryRepository: RepositoryRepository;
  userRepository: UserRepository;
  serviceRepository: ServiceRepository;
  gitHubAppService: GitHubAppService;
  apiKeyService: ApiKeyService;
  planEnforcementService: PlanEnforcementService;
  trialService: TrialService;
  analytics?: AnalyticsService;
};

export function registerOnboardingRoutes(
  app: FastifyInstance,
  deps: OnboardingRoutesDeps,
): void {
  const {
    accountRepository,
    repositoryRepository,
    userRepository,
    serviceRepository,
    gitHubAppService,
    apiKeyService,
    planEnforcementService,
    trialService,
    analytics,
  } = deps;

  // GET /onboarding/plan-selection - Plan selection page
  app.get(
    "/onboarding/plan-selection",
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

      // If account already has a non-Free plan set (returning user), skip to
      // service creation.
      if (account.plan !== Plan.Free) {
        return reply.redirect("/onboarding/service");
      }

      // Show plan selection page
      analytics?.navigation("plan_selection");
      return reply.view(
        "onboarding/plan-selection",
        {
          title: "Choose Your Plan",
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /onboarding/select-plan - Handle plan selection
  app.post<{ Body: { plan: string } }>(
    "/onboarding/select-plan",
    async (
      request: FastifyRequest<{ Body: { plan: string } }>,
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

      // Validate plan
      const { plan } = request.body;
      if (!plan || !["free", "pro", "team"].includes(plan)) {
        return reply.status(400).send({ error: "Invalid plan" });
      }

      const selectedPlan = plan as Plan;

      // If paid plan (Pro or Team), attempt to start trial
      if (selectedPlan === Plan.Pro || selectedPlan === Plan.Team) {
        // Get user's GitHub ID from session
        const user = await userRepository.findById(
          new ObjectId(request.session.userId),
        );
        if (user) {
          const trialResult = await trialService.startTrial(
            account._id,
            user.githubId,
            selectedPlan,
          );

          // If trial didn't start (already used), still select the plan
          // User chose this plan, so respect their choice
          if (trialResult.started) {
            analytics?.track("trial_started", {
              plan: selectedPlan,
              accountId: account._id.toString(),
            });
          } else {
            console.log(
              `Trial not started for account ${account._id}: ${trialResult.reason}`,
            );
          }
        }
      }

      // Set plan on account (always, even if trial didn't start)
      await accountRepository.selectPlan(account._id, selectedPlan);
      analytics?.track("plan_selected", {
        plan: selectedPlan,
        accountId: account._id.toString(),
      });

      // Reporting-first onboarding: create the service next.
      return reply.redirect("/onboarding/service");
    },
  );

  // GET /onboarding/service - Step 1: name your service + repo URL
  app.get(
    "/onboarding/service",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }
      analytics?.navigation("onboarding_service");
      return reply.view(
        "onboarding/service",
        { title: "Create your service" },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /onboarding/service - Create a report-only service (no CD yet)
  app.post<{ Body: { name?: string } }>(
    "/onboarding/service",
    async (
      request: FastifyRequest<{ Body: { name?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }
      const account = await accountRepository.findById(
        new ObjectId(request.session.accountId),
      );
      if (!account) {
        return reply.redirect("/auth/github");
      }

      const name = request.body.name?.trim() || "";

      const renderError = (error: string) =>
        reply.view(
          "onboarding/service",
          { title: "Create your service", error, name },
          { layout: "/layouts/main.hbs" },
        );

      if (!name) {
        return renderError("Enter a service name.");
      }

      const canAdd = await planEnforcementService.canAddService(account._id);
      if (!canAdd.allowed) {
        return renderError(canAdd.reason ?? "Service limit reached.");
      }

      let service;
      try {
        // No deployment and no repoUrl yet — CD is configured in the
        // deploy-setup step; the source repo (for SHA links) is set up later.
        service = await serviceRepository.create({
          accountId: account._id,
          name,
        });
      } catch (error: any) {
        if (error.code === 11000) {
          return renderError("A service with this name already exists.");
        }
        throw error;
      }

      const { key } = await apiKeyService.generate({
        accountId: account._id,
        createdByUserId: new ObjectId(request.session.userId),
        name: `${name} API Key`,
        scopes: ["builds:read", "builds:write", "deployments:write"],
      });
      // Signed cookie so the reporting guide can show the key once.
      reply.setCookie("onboarding_api_key", key, {
        signed: true,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 3600,
      });

      analytics?.track("service_created", {
        serviceName: name,
        accountId: account._id.toString(),
        provider: "onboarding",
      });

      return reply.redirect(`/onboarding/report-builds/${service._id}`);
    },
  );

  // GET /onboarding/report-builds/:serviceId - Step 2: report a build (tabs)
  app.get<{ Params: { serviceId: string } }>(
    "/onboarding/report-builds/:serviceId",
    async (
      request: FastifyRequest<{ Params: { serviceId: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }
      const accountId = new ObjectId(request.session.accountId);

      let serviceObjectId: ObjectId;
      try {
        serviceObjectId = new ObjectId(request.params.serviceId);
      } catch {
        return reply.status(400).send("Invalid service ID");
      }
      const service = await serviceRepository.findByAccountAndId(
        accountId,
        serviceObjectId,
      );
      if (!service) {
        return reply.status(404).send("Service not found");
      }

      const apiKeyCookie = request.cookies.onboarding_api_key;
      const apiKey = apiKeyCookie
        ? reply.unsignCookie(apiKeyCookie).value
        : null;

      const environments = [...service.environments].sort(
        (a, b) => a.order - b.order,
      );

      analytics?.navigation("onboarding_report_builds");
      return reply.view(
        "onboarding/report-builds",
        {
          title: "Report your first build",
          serviceId: service._id.toString(),
          serviceName: service.name,
          apiUrl: process.env.PUBLIC_URL,
          apiKey,
          firstEnv: environments[0]?.name ?? "staging",
          // Dev-only: report a fake build to exercise the SSE → next-step flow
          // without a real CI pipeline.
          showSimulateBuild: process.env.ENABLE_BUILD_SIMULATION === "true",
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // Step 3: set up CD. Loads the service (ownership-checked) and connection
  // state, then renders the deploy-setup tabs (or an error re-render).
  async function renderSetupDeploy(
    request: FastifyRequest<{ Params: { serviceId: string } }>,
    reply: FastifyReply,
    error?: string,
  ) {
    if (!request.session) {
      reply.redirect("/auth/github");
      return null;
    }
    const accountId = new ObjectId(request.session.accountId);
    const account = await accountRepository.findById(accountId);
    if (!account) {
      reply.redirect("/auth/github");
      return null;
    }
    let serviceObjectId: ObjectId;
    try {
      serviceObjectId = new ObjectId(request.params.serviceId);
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

    const repositories = await repositoryRepository.findByAccountId(accountId);
    const environments = [...service.environments].sort(
      (a, b) => a.order - b.order,
    );
    const useFakeGitHub = process.env.USE_FAKE_GITHUB === "true";
    const installUrl = useFakeGitHub
      ? "/github/installation/callback?installation_id=12345"
      : `https://github.com/apps/${process.env.GH_APP_NAME || "gitlaunchapp"}/installations/new`;

    reply.view(
      "onboarding/setup-deploy",
      {
        title: "Set up deployments",
        serviceId: service._id.toString(),
        serviceName: service.name,
        apiUrl: process.env.PUBLIC_URL,
        firstEnv: environments[0]?.name ?? "staging",
        environments,
        githubConnected: account.githubConnection != null,
        jenkinsConnected: account.jenkinsConnection != null,
        installUrl,
        repositories: repositories.map((r) => ({
          id: r._id.toString(),
          fullName: r.githubFullName,
        })),
        error,
      },
      { layout: "/layouts/main.hbs" },
    );
    return { service, accountId };
  }

  // GET /onboarding/setup-deploy/:serviceId - Step 3: choose a CD strategy
  app.get<{ Params: { serviceId: string } }>(
    "/onboarding/setup-deploy/:serviceId",
    async (request, reply) => {
      await renderSetupDeploy(request, reply);
    },
  );

  // Load + verify a service for a setup-deploy POST.
  async function loadForSetup(
    request: FastifyRequest<{ Params: { serviceId: string } }>,
    reply: FastifyReply,
  ) {
    if (!request.session) {
      reply.redirect("/auth/github");
      return null;
    }
    const accountId = new ObjectId(request.session.accountId);
    let serviceObjectId: ObjectId;
    try {
      serviceObjectId = new ObjectId(request.params.serviceId);
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

  // POST .../github - configure GitHub Actions dispatch (repo + workflow)
  app.post<{
    Params: { serviceId: string };
    Body: { repositoryId?: string; workflowFile?: string };
  }>("/onboarding/setup-deploy/:serviceId/github", async (request, reply) => {
    const loaded = await loadForSetup(request, reply);
    if (!loaded) return;
    const { service, accountId } = loaded;

    const repositoryId = request.body.repositoryId?.trim() || "";
    if (!repositoryId) {
      return renderSetupDeploy(request, reply, "Select a repository.");
    }
    let repoObjectId: ObjectId;
    try {
      repoObjectId = new ObjectId(repositoryId);
    } catch {
      return renderSetupDeploy(request, reply, "Invalid repository.");
    }
    const repository = await repositoryRepository.findById(repoObjectId);
    if (!repository || !repository.accountId.equals(accountId)) {
      return renderSetupDeploy(request, reply, "Invalid repository.");
    }

    await serviceRepository.setDeployment(accountId, service._id, {
      provider: "github",
      repositoryId: repoObjectId,
      workflowFile: request.body.workflowFile?.trim() || "deploy.yml",
    });
    analytics?.track("deployment_configured", {
      serviceId: service._id.toString(),
      provider: "github",
    });
    return reply.redirect(`/dashboard/${service.name}`);
  });

  // POST .../jenkins - configure Jenkins dispatch (job name)
  app.post<{
    Params: { serviceId: string };
    Body: { jobName?: string };
  }>("/onboarding/setup-deploy/:serviceId/jenkins", async (request, reply) => {
    const loaded = await loadForSetup(request, reply);
    if (!loaded) return;
    const { service, accountId } = loaded;

    const account = await accountRepository.findById(accountId);
    if (!account?.jenkinsConnection) {
      return renderSetupDeploy(
        request,
        reply,
        "Connect a Jenkins server first.",
      );
    }
    const jobName = request.body.jobName?.trim() || "";
    if (!jobName) {
      return renderSetupDeploy(request, reply, "Enter a Jenkins job name.");
    }

    await serviceRepository.setDeployment(accountId, service._id, {
      provider: "jenkins",
      jobName,
    });
    analytics?.track("deployment_configured", {
      serviceId: service._id.toString(),
      provider: "jenkins",
    });
    return reply.redirect(`/dashboard/${service.name}`);
  });

  // POST .../raw - configure a raw webhook endpoint
  app.post<{
    Params: { serviceId: string };
    Body: { endpointUrl?: string };
  }>("/onboarding/setup-deploy/:serviceId/raw", async (request, reply) => {
    const loaded = await loadForSetup(request, reply);
    if (!loaded) return;
    const { service, accountId } = loaded;

    const endpointUrl = request.body.endpointUrl?.trim() || "";
    if (!endpointUrl) {
      return renderSetupDeploy(request, reply, "Enter a deploy endpoint URL.");
    }

    await serviceRepository.setDeployment(accountId, service._id, {
      provider: "raw",
      endpointUrl,
    });
    analytics?.track("deployment_configured", {
      serviceId: service._id.toString(),
      provider: "raw",
    });
    return reply.redirect(`/dashboard/${service.name}`);
  });

  // GET /onboarding - Legacy entry point. The old choose-a-CI-provider fork is
  // retired (provider choice now happens per service in the deploy-setup step);
  // forward to the dashboard so old bookmarks don't 404.
  app.get(
    "/onboarding",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }
      return reply.redirect("/dashboard");
    },
  );

  // GET /onboarding/repositories - Repository selection page
  app.get<{ Querystring: { returnTo?: string } }>(
    "/onboarding/repositories",
    async (
      request: FastifyRequest<{ Querystring: { returnTo?: string } }>,
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

      // If GitHub App is not installed, redirect to install page
      if (!account.githubConnection) {
        return reply.redirect("/onboarding");
      }

      // Fetch available repositories from GitHub App installation
      let repositories: Array<{
        id: number;
        full_name: string;
        private: boolean;
      }> = [];
      try {
        repositories = await gitHubAppService.listInstallationRepos(
          account._id,
        );
      } catch (error) {
        console.error("Failed to fetch repositories:", error);
      }

      // Get plan usage info to show limits in UI
      const usage = await planEnforcementService.getUsage(account._id);

      // Get returnTo for redirecting after completion
      const returnTo = request.query.returnTo;

      analytics?.navigation("repository_selection", {
        repoCount: repositories.length,
      });

      return reply.view(
        "onboarding/select-repos",
        {
          title: "Select Repositories",
          repositories,
          maxRepositories: usage.repositories.limit,
          privateReposAllowed: usage.privateReposAllowed,
          plan: usage.plan,
          returnTo,
          githubInstallationId: account.githubConnection.installationId,
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /onboarding/repositories - Save selected repositories
  app.post<{
    Body: { repositories?: string | string[]; returnTo?: string };
  }>(
    "/onboarding/repositories",
    async (
      request: FastifyRequest<{
        Body: { repositories?: string | string[]; returnTo?: string };
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

      // Get selected repository IDs from form
      const selectedRepoIds = request.body.repositories
        ? Array.isArray(request.body.repositories)
          ? request.body.repositories.map((id) => parseInt(id, 10))
          : [parseInt(request.body.repositories, 10)]
        : [];

      // Save selected repositories if any
      if (selectedRepoIds.length > 0) {
        try {
          // Fetch all available repos from GitHub App installation
          const availableRepos = await gitHubAppService.listInstallationRepos(
            account._id,
          );

          // Filter to only selected repos
          const selectedRepos = availableRepos.filter((repo) =>
            selectedRepoIds.includes(repo.id),
          );

          // Check repository limits BEFORE creating any repos
          // First: check if adding selected repos would exceed limit (accounting for existing repos)
          const usage = await planEnforcementService.getUsage(account._id);
          const totalAfterAdding =
            usage.repositories.current + selectedRepos.length;
          if (totalAfterAdding > usage.repositories.limit) {
            const errorMessage = `Repository limit reached (${usage.repositories.current}/${usage.repositories.limit}). Upgrade to add more repositories.`;
            return reply.view(
              "onboarding/select-repos",
              {
                title: "Select Repositories",
                repositories: availableRepos,
                maxRepositories: usage.repositories.limit,
                privateReposAllowed: usage.privateReposAllowed,
                plan: usage.plan,
                error: errorMessage,
              },
              { layout: "/layouts/main.hbs" },
            );
          }

          // Second: check if any private repos are selected when not allowed
          const hasPrivateRepo = selectedRepos.some((repo) => repo.private);
          if (hasPrivateRepo) {
            const canAddPrivate =
              await planEnforcementService.canAddPrivateRepository(account._id);
            if (!canAddPrivate.allowed) {
              return reply.view(
                "onboarding/select-repos",
                {
                  title: "Select Repositories",
                  repositories: availableRepos,
                  maxRepositories: usage.repositories.limit,
                  privateReposAllowed: usage.privateReposAllowed,
                  plan: usage.plan,
                  error: canAddPrivate.reason,
                },
                { layout: "/layouts/main.hbs" },
              );
            }
          }

          // Save each selected repo
          for (const repo of selectedRepos) {
            await repositoryRepository.create({
              accountId: account._id,
              githubRepoId: repo.id,
              githubFullName: repo.full_name,
              githubOwner: repo.owner?.login || repo.full_name.split("/")[0],
              githubRepoName: repo.name || repo.full_name.split("/")[1],
              isPrivate: repo.private,
            });
          }
        } catch (error) {
          console.error("Failed to save repositories:", error);
        }
      }

      analytics?.track("repositories_selected", {
        count: selectedRepoIds.length,
        accountId: account._id.toString(),
      });

      // Redirect to returnTo if provided, otherwise to dashboard
      const redirectTo = request.body.returnTo || "/dashboard";
      return reply.redirect(redirectTo);
    },
  );
}
