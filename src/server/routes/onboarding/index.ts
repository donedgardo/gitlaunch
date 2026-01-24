import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { AccountRepository } from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { GitHubAppService } from "../../../services/github/githubAppService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";

export type OnboardingRoutesDeps = {
  accountRepository: AccountRepository;
  repositoryRepository: RepositoryRepository;
  gitHubAppService: GitHubAppService;
  planEnforcementService: PlanEnforcementService;
};

export function registerOnboardingRoutes(
  app: FastifyInstance,
  deps: OnboardingRoutesDeps,
): void {
  const {
    accountRepository,
    repositoryRepository,
    gitHubAppService,
    planEnforcementService,
  } = deps;

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
      const githubAppName = process.env.GH_APP_NAME || "gitlaunchapp";
      const installUrl = `https://github.com/apps/${githubAppName}/installations/new`;

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

      return reply.view(
        "onboarding/select-repos",
        {
          title: "Select Repositories",
          repositories,
          maxRepositories: usage.repositories.limit,
          privateReposAllowed: usage.privateReposAllowed,
          plan: usage.plan,
          returnTo,
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

          // Get plan usage to check limits
          const usage = await planEnforcementService.getUsage(account._id);

          // Check if selected count exceeds plan limit
          if (selectedRepos.length > usage.repositories.limit) {
            const errorMessage = `Your ${usage.plan} plan allows up to ${usage.repositories.limit} repository. Please select fewer repositories or upgrade your plan.`;
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

          // Check if any private repos are selected when plan doesn't allow
          const hasPrivateRepo = selectedRepos.some((repo) => repo.private);
          if (hasPrivateRepo && !usage.privateReposAllowed) {
            const errorMessage =
              "Private repositories require a paid plan. Please select only public repositories or upgrade your plan.";
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

      // Redirect to returnTo if provided, otherwise to dashboard
      const redirectTo = request.body.returnTo || "/dashboard";
      return reply.redirect(redirectTo);
    },
  );
}
