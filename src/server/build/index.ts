import EventEmitter, { on } from "node:events";
import { FastifyInstance, FastifyReply } from "fastify";
import { ServiceI } from "../../services/service/interface";
import * as Handlebars from "handlebars";
import { FastifyRequestType } from "fastify/types/type-provider";

export default function (services: ServiceI[], eventEmitter: EventEmitter) {
  return function (server: FastifyInstance, opts: any, done: any) {
    server.addHook("preHandler", (req, res, done) => {
      if (req.user || req.isApiKeyValid) {
        return done();
      }
      return res.status(403).send("Not Authorized");
    });
    server.get("/build-update-stream", async (req, res) => {
      const abortController = new AbortController();
      const buildEnvActionTemplate = Handlebars.compile(
        "{{>buildEnvironmentAction}}",
      );
      res.sse(
        (async function* () {
          for await (const [updatedBuildEvents] of on(
            eventEmitter,
            "build:update",
          )) {
            for (const event of updatedBuildEvents) {
              const html = buildEnvActionTemplate({
                buildId: event.buildId,
                env: event.environment,
                serviceName: event.serviceName,
                status: event.status,
              });
              yield {
                event: `update:${event.serviceName}-${event.buildId}-${event.environment}`,
                data: html.replace(/(\r\n|\n|\r)/gm, ""),
              };
            }
          }
        })(),
      );

      req.socket.on("close", () => abortController.abort());
    });
    for (let service of services) {
      const serviceName = service.getName();
      server.patch(
        `/${serviceName}/build/:buildId/:environment/:status`,
        updateBuildStatusHandler(service),
      );
      server.post(`/api/${serviceName}/build/:buildId`, async (req, res) => {
        const { buildId } = req.params as any;
        await service.create(buildId);
        res.send();
      });
      server.patch(
        `/api/${serviceName}/build/:buildId/:environment/:status`,
        updateBuildStatusHandler(service),
      );
    }
    done();
  };
}

function updateBuildStatusHandler(service: ServiceI) {
  return async (req: FastifyRequestType, res: FastifyReply) => {
    const { buildId, environment, status } = req.params as any;
    try {
      const build = await service.updateDeploymentStatus(
        buildId,
        environment,
        status,
      );
      return res.view("/partials/buildEnvironmentAction.hbs", {
        buildId,
        status: build.deployments[environment],
        env: environment,
        serviceName: service.getName(),
      });
    } catch (e) {
      console.error(e);
      return res.status(404).send();
    }
  };
}
