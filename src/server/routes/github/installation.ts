import { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { GithubConnectionService } from "../../../services/github/githubConnectionService";
import { AnalyticsService } from "../../../services/analytics/analytics";

type InstallationRouteDeps = {
  githubConnectionService: GithubConnectionService;
  analytics?: AnalyticsService;
};

export function registerInstallationRoutes(
  app: FastifyInstance,
  deps: InstallationRouteDeps,
): void {
  app.get<{
    Querystring: { installation_id?: string; setup_action?: string };
  }>("/github/installation/callback", async (request, reply) => {
    // Redirect to login if not authenticated
    if (!request.session) {
      return reply.redirect("/auth/github");
    }

    const installationIdStr = request.query.installation_id;
    if (!installationIdStr) {
      return reply.status(400).send({ error: "Missing installation_id" });
    }

    const accountId = new ObjectId(request.session.accountId);
    const installationId = parseInt(installationIdStr, 10);

    await deps.githubConnectionService.connect({ accountId, installationId });
    deps.analytics?.track("github_app_installed", {
      accountId: accountId.toString(),
      installationId,
    });

    return reply.redirect("/onboarding/repositories");
  });
}
