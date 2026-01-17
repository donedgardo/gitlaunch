import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { AccountRepository } from "../../../repositories/accountRepository";
import { GitHubAppService } from "../../../services/github/githubAppService";

export type OnboardingRoutesDeps = {
  accountRepository: AccountRepository;
  gitHubAppService: GitHubAppService;
};

export function registerOnboardingRoutes(
  app: FastifyInstance,
  deps: OnboardingRoutesDeps,
): void {
  const { accountRepository, gitHubAppService } = deps;

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
      const githubAppName = process.env.GITHUB_APP_NAME || "gitdeploy";
      const installUrl = `https://github.com/apps/${githubAppName}/installations/new`;

      return reply.view("onboarding/install-github", {
        title: "Connect GitHub",
        accountName: account.name,
        installUrl,
      });
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

      return reply.view("onboarding/select-repos", {
        title: "Select Repositories",
        repositories,
      });
    },
  );

  // POST /onboarding/repositories - Save selected repositories
  app.post<{
    Body: { repositories?: string[] };
  }>(
    "/onboarding/repositories",
    async (
      request: FastifyRequest<{ Body: { repositories?: string[] } }>,
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

      // TODO: Save selected repositories to the database
      // For now, just redirect to dashboard

      return reply.redirect("/dashboard");
    },
  );
}
