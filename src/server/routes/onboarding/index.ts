import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { AccountRepository } from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { GitHubAppService } from "../../../services/github/githubAppService";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import { PlanEnforcementService } from "../../../services/billing/planEnforcementService";

export type OnboardingRoutesDeps = {
  accountRepository: AccountRepository;
  repositoryRepository: RepositoryRepository;
  gitHubAppService: GitHubAppService;
  apiKeyService: ApiKeyService;
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
    apiKeyService,
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

      // Get plan usage info to show limits in UI
      const usage = await planEnforcementService.getUsage(account._id);

      return reply.view(
        "onboarding/select-repos",
        {
          title: "Select Repositories",
          repositories,
          maxRepositories: usage.repositories.limit,
          privateReposAllowed: usage.privateReposAllowed,
          plan: usage.plan,
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

          // Filter to only selected repos
          const selectedRepos = availableRepos.filter((repo) =>
            selectedRepoIds.includes(repo.id),
          );

          // Get plan usage to check limits
          const usage = await planEnforcementService.getUsage(account._id);

          // Check if selected count exceeds plan limit
          if (selectedRepos.length > usage.repositories.limit) {
            const errorMessage = `Your ${usage.plan} plan allows up to ${usage.repositories.limit} repository. Please select fewer repositories or upgrade your plan.`;
            if (typeof reply.view === "function") {
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
            return reply.status(400).send({ error: errorMessage });
          }

          // Check if any private repos are selected when plan doesn't allow
          const hasPrivateRepo = selectedRepos.some((repo) => repo.private);
          if (hasPrivateRepo && !usage.privateReposAllowed) {
            const errorMessage =
              "Private repositories require a paid plan. Please select only public repositories or upgrade your plan.";
            if (typeof reply.view === "function") {
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
            return reply.status(400).send({ error: errorMessage });
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

      // Generate API key for the account
      const { key } = await apiKeyService.generate({
        accountId: account._id,
        createdByUserId: new ObjectId(request.session.userId),
        name: "Default API Key",
        scopes: ["builds:read", "builds:write", "deployments:write"],
      });

      // Store API key in a signed, short-lived cookie (not in URL for security)
      reply.setCookie("onboarding_api_key", key, {
        signed: true,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/onboarding/complete",
        maxAge: 300, // 5 minutes - just enough time to view and copy
      });

      // Redirect to onboarding complete page (key is in cookie, not URL)
      return reply.redirect("/onboarding/complete");
    },
  );

  // GET /onboarding/complete - Show API key and completion message
  app.get(
    "/onboarding/complete",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Redirect to login if not authenticated
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      // Get API key from signed cookie
      const signedCookie = request.cookies.onboarding_api_key;
      const apiKey = signedCookie
        ? reply.unsignCookie(signedCookie).value
        : null;

      // Clear the cookie immediately (one-time display)
      reply.clearCookie("onboarding_api_key", {
        path: "/onboarding/complete",
      });

      // If no API key (already viewed or expired), redirect to dashboard
      if (!apiKey) {
        return reply.redirect("/dashboard");
      }

      // Use template if view engine is available, otherwise simple HTML
      if (typeof reply.view === "function") {
        return reply.view(
          "onboarding/complete",
          {
            title: "Setup Complete",
            apiKey,
          },
          { layout: "/layouts/main.hbs" },
        );
      }

      // Fallback for unit tests without view engine
      return reply.header("Content-Type", "text/html").send(`
          <!DOCTYPE html>
          <html>
          <head><title>Setup Complete</title></head>
          <body>
            <h1>Your API Key</h1>
            <p>Use this key in your CI/CD pipelines to report build and deployment status.</p>
            <code id="api-key">${apiKey}</code>
            <button onclick="navigator.clipboard.writeText('${apiKey}')">Copy</button>
            <a href="/dashboard">Continue to Dashboard</a>
          </body>
          </html>
        `);
    },
  );
}
