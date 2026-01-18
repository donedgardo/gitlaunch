import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { AccountRepository } from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { GitHubAppService } from "../../../services/github/githubAppService";

export type OnboardingRoutesDeps = {
  accountRepository: AccountRepository;
  repositoryRepository: RepositoryRepository;
  gitHubAppService: GitHubAppService;
};

export function registerOnboardingRoutes(
  app: FastifyInstance,
  deps: OnboardingRoutesDeps,
): void {
  const { accountRepository, repositoryRepository, gitHubAppService } = deps;

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
  app.get(
    "/onboarding/repositories",
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

      return reply.view(
        "onboarding/select-repos",
        {
          title: "Select Repositories",
          repositories,
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /onboarding/repositories - Save selected repositories
  app.post<{
    Body: { repositories?: string | string[] };
  }>(
    "/onboarding/repositories",
    async (
      request: FastifyRequest<{ Body: { repositories?: string | string[] } }>,
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

          // Filter to only selected repos and save each one
          for (const repo of availableRepos) {
            if (selectedRepoIds.includes(repo.id)) {
              await repositoryRepository.create({
                accountId: account._id,
                githubRepoId: repo.id,
                githubFullName: repo.full_name,
                githubOwner: repo.owner?.login || repo.full_name.split("/")[0],
                githubRepoName: repo.name || repo.full_name.split("/")[1],
                isPrivate: repo.private,
              });
            }
          }
        } catch (error) {
          console.error("Failed to save repositories:", error);
        }
      }

      return reply.redirect("/dashboard");
    },
  );
}
