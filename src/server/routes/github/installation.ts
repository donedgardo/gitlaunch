import { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { GithubConnectionService } from "../../../services/github/githubConnectionService";
import { AnalyticsService } from "../../../services/analytics/analytics";
import { posthog } from "../../../instrument";

type InstallationRouteDeps = {
  githubConnectionService: GithubConnectionService;
  analytics?: AnalyticsService;
};

export function registerInstallationRoutes(
  app: FastifyInstance,
  deps: InstallationRouteDeps,
): void {
  app.get<{
    Querystring: {
      installation_id?: string;
      setup_action?: string;
      returnTo?: string;
    };
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
    posthog?.capture({ event: "github_app_installed" });
    await posthog?.flush();

    // Repository selection is always the next step; carry a caller-supplied
    // returnTo through it so a connect started from e.g. deploy setup comes
    // back there. Only accept local paths — never redirect off-site.
    const returnTo = request.query.returnTo;
    const isLocalPath =
      typeof returnTo === "string" &&
      returnTo.startsWith("/") &&
      !returnTo.startsWith("//");
    if (isLocalPath) {
      return reply.redirect(
        `/onboarding/repositories?returnTo=${encodeURIComponent(returnTo)}`,
      );
    }

    return reply.redirect("/onboarding/repositories");
  });
}
