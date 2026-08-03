import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { GithubConnectionService } from "../../../services/github/githubConnectionService";
import { githubInstallUrl } from "../../githubInstallUrl";

export type GithubSettingsRoutesDeps = {
  githubConnectionService: GithubConnectionService;
  github: { useFakes: boolean; appName?: string };
};

export function registerGithubSettingsRoutes(
  app: FastifyInstance,
  deps: GithubSettingsRoutesDeps,
): void {
  const { githubConnectionService, github } = deps;

  async function renderPage(accountId: ObjectId, reply: FastifyReply) {
    const connection = await githubConnectionService.getView(accountId);
    return reply.view(
      "settings/github",
      {
        title: "GitHub",
        connection: connection
          ? {
              installationId: connection.installationId,
              connectedAt: connection.connectedAt.toISOString().split("T")[0],
            }
          : null,
        installUrl: githubInstallUrl(github),
      },
      { layout: "/layouts/main.hbs" },
    );
  }

  // GET /settings/github - Show connection status / connect prompt
  app.get(
    "/settings/github",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }
      const accountId = new ObjectId(request.session.accountId);
      return renderPage(accountId, reply);
    },
  );

  // DELETE /settings/github - Disconnect the GitHub App
  app.delete(
    "/settings/github",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }
      const accountId = new ObjectId(request.session.accountId);
      await githubConnectionService.disconnect(accountId);
      return renderPage(accountId, reply);
    },
  );
}
