import { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { GitHubAppService } from "../../../services/github/githubAppService";

type InstallationRouteDeps = {
  gitHubAppService: GitHubAppService;
};

export function registerInstallationRoutes(
  app: FastifyInstance,
  deps: InstallationRouteDeps,
): void {
  app.get<{
    Querystring: { installation_id?: string; setup_action?: string };
  }>("/github/installation/callback", async (request, reply) => {
    // For this simple test, we use x-account-id header
    // In production, this would come from session middleware
    const accountIdHeader = request.headers["x-account-id"] as
      | string
      | undefined;

    if (!accountIdHeader) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const installationIdStr = request.query.installation_id;
    if (!installationIdStr) {
      return reply.status(400).send({ error: "Missing installation_id" });
    }

    const accountId = new ObjectId(accountIdHeader);
    const installationId = parseInt(installationIdStr, 10);

    await deps.gitHubAppService.linkInstallation(accountId, installationId);

    return reply.redirect("/settings/repositories");
  });
}
