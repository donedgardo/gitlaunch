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
    // Use session from session middleware
    if (!request.session) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const installationIdStr = request.query.installation_id;
    if (!installationIdStr) {
      return reply.status(400).send({ error: "Missing installation_id" });
    }

    const accountId = new ObjectId(request.session.accountId);
    const installationId = parseInt(installationIdStr, 10);

    await deps.gitHubAppService.linkInstallation(accountId, installationId);

    return reply.redirect("/settings/repositories");
  });
}
