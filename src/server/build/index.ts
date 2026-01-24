import EventEmitter from "node:events";
import { FastifyInstance, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceI } from "../../services/service/interface";
import { ServiceRepository } from "../../repositories/serviceRepository";
import * as Handlebars from "handlebars";
import { FastifyRequestType } from "fastify/types/type-provider";

export type BuildRoutesDeps = {
  services: ServiceI[];
  eventEmitter: EventEmitter;
  serviceRepository: ServiceRepository;
};

export default function (deps: BuildRoutesDeps) {
  const { services, eventEmitter, serviceRepository } = deps;

  return function (server: FastifyInstance, opts: any, done: any) {
    server.addHook("preHandler", (req, res, done) => {
      if (req.session || req.user || req.isApiKeyValid) {
        return done();
      }
      return res.status(403).send("Not Authorized");
    });
    server.get("/build-update-stream", async (req, res) => {
      const abortController = new AbortController();
      const buildEnvActionTemplate = Handlebars.compile(
        "{{>buildEnvironmentAction}}",
      );

      // Create a queue to buffer events
      const eventQueue: any[] = [];
      let resolver: ((value: any) => void) | null = null;

      const listener = (updatedBuildEvents: any[]) => {
        for (const event of updatedBuildEvents) {
          if (resolver) {
            resolver(event);
            resolver = null;
          } else {
            eventQueue.push(event);
          }
        }
      };

      eventEmitter.on("build:update", listener);

      res.sse(
        (async function* () {
          try {
            while (!abortController.signal.aborted) {
              // Wait for event or timeout for keep-alive
              const event = await Promise.race([
                eventQueue.length > 0
                  ? Promise.resolve(eventQueue.shift())
                  : new Promise((resolve) => {
                      resolver = resolve;
                    }),
                new Promise((resolve) =>
                  setTimeout(() => resolve(null), 25000),
                ), // 25s keep-alive
              ]);

              if (event === null) {
                // Send keep-alive comment to prevent proxy timeout
                yield { comment: "keep-alive" };
              } else {
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
          } finally {
            eventEmitter.off("build:update", listener);
          }
        })(),
      );

      req.socket.on("close", () => {
        abortController.abort();
        eventEmitter.off("build:update", listener);
      });
    });

    // SSE endpoint for detecting when a build is created (used by setup page)
    server.get("/build-created-stream/:serviceId", async (req, res) => {
      const { serviceId } = req.params as { serviceId: string };

      // Verify the user owns this service
      const accountId = req.session?.accountId || req.apiKey?.accountId;
      if (!accountId || !ObjectId.isValid(serviceId)) {
        return res.status(403).send("Not authorized");
      }

      const service = await serviceRepository.findById(new ObjectId(serviceId));
      if (!service || service.accountId.toString() !== accountId.toString()) {
        return res.status(403).send("Not authorized");
      }

      // Create a queue to buffer events
      const eventQueue: any[] = [];
      let resolver: ((value: any) => void) | null = null;

      const listener = (event: any) => {
        if (event.serviceId === serviceId) {
          if (resolver) {
            resolver(event);
            resolver = null;
          } else {
            eventQueue.push(event);
          }
        }
      };

      eventEmitter.on("build:created", listener);

      res.sse(
        (async function* () {
          try {
            while (true) {
              const event =
                eventQueue.length > 0
                  ? eventQueue.shift()
                  : await new Promise((resolve) => {
                      resolver = resolve;
                    });

              yield {
                event: "build:created",
                data: JSON.stringify({
                  serviceName: event.serviceName,
                  buildId: event.buildId,
                }),
              };
            }
          } finally {
            eventEmitter.off("build:created", listener);
          }
        })(),
      );

      req.socket.on("close", () => {
        eventEmitter.off("build:created", listener);
      });
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
