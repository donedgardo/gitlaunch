import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { JenkinsConnectionService } from "../../../services/jenkins/jenkinsConnectionService";

export type JenkinsSettingsRoutesDeps = {
  jenkinsConnectionService: JenkinsConnectionService;
};

type ConnectBody = {
  baseUrl?: string;
  username?: string;
  apiToken?: string;
};

export function registerJenkinsSettingsRoutes(
  app: FastifyInstance,
  deps: JenkinsSettingsRoutesDeps,
): void {
  const { jenkinsConnectionService } = deps;

  async function renderPage(
    accountId: ObjectId,
    reply: FastifyReply,
    extra: { error?: string } = {},
  ) {
    const connection = await jenkinsConnectionService.getView(accountId);
    return reply.view(
      "settings/jenkins",
      {
        title: "Jenkins",
        connection: connection
          ? {
              baseUrl: connection.baseUrl,
              username: connection.username,
              updatedAt: connection.updatedAt.toISOString().split("T")[0],
            }
          : null,
        error: extra.error,
      },
      { layout: "/layouts/main.hbs" },
    );
  }

  // GET /settings/jenkins - Show connection status / connect form
  app.get(
    "/settings/jenkins",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }
      const accountId = new ObjectId(request.session.accountId);
      return renderPage(accountId, reply);
    },
  );

  // POST /settings/jenkins - Save (connect) the Jenkins credentials
  app.post<{ Body: ConnectBody }>(
    "/settings/jenkins",
    async (
      request: FastifyRequest<{ Body: ConnectBody }>,
      reply: FastifyReply,
    ) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }
      const accountId = new ObjectId(request.session.accountId);
      const baseUrl = request.body.baseUrl?.trim();
      const username = request.body.username?.trim();
      const apiToken = request.body.apiToken;

      if (!baseUrl || !username || !apiToken) {
        reply.status(400);
        return renderPage(accountId, reply, {
          error: "Base URL, username, and API token are all required.",
        });
      }

      await jenkinsConnectionService.connect({
        accountId,
        baseUrl,
        username,
        apiToken,
      });

      return renderPage(accountId, reply);
    },
  );

  // DELETE /settings/jenkins - Disconnect (remove the stored credentials)
  app.delete(
    "/settings/jenkins",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }
      const accountId = new ObjectId(request.session.accountId);
      await jenkinsConnectionService.disconnect(accountId);
      return renderPage(accountId, reply);
    },
  );
}
