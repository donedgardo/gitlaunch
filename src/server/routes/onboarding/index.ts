import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import {
  AccountRepository,
  Plan,
} from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { UserRepository } from "../../../repositories/userRepository";
import { GitHubAppService } from "../../../services/github/githubAppService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";
import { TrialService } from "../../../services/billing/trialService";
import { AnalyticsService } from "../../../services/analytics/analytics";

export type OnboardingRoutesDeps = {
  accountRepository: AccountRepository;
  repositoryRepository: RepositoryRepository;
  userRepository: UserRepository;
  gitHubAppService: GitHubAppService;
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
    gitHubAppService,
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

      // If account already has a non-Free plan set (returning user), skip to GitHub App install
      if (account.plan !== Plan.Free) {
        return reply.redirect("/onboarding");
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

      // Redirect to GitHub App install step
      return reply.redirect("/onboarding");
    },
  );

  // GET /onboarding - Main onboarding page
  app.get(
    "/onboarding",
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

      // If GitHub App is already installed, redirect to repo selection
      if (account.githubInstallationId) {
        return reply.redirect("/onboarding/repositories");
      }

      // Show GitHub App installation page
      analytics?.navigation("github_app_install");
      const useFakeGitHub = process.env.USE_FAKE_GITHUB === "true";
      const installUrl = useFakeGitHub
        ? "/github/installation/callback?installation_id=12345"
        : `https://github.com/apps/${process.env.GH_APP_NAME || "gitlaunchapp"}/installations/new`;

      return reply.view(
        "onboarding/install-github",
        {
          title: "Connect GitHub",
          accountName: account.name,
          installUrl,
        },
        { layout: "/layouts/main.hbs" },
      );
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
      if (!account.githubInstallationId) {
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
          githubInstallationId: account.githubInstallationId,
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
