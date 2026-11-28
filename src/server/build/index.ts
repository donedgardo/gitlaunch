import EventEmitter from "node:events";
import { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../repositories/serviceRepository";
import * as Handlebars from "handlebars";

export type BuildRoutesDeps = {
  eventEmitter: EventEmitter;
  serviceRepository: ServiceRepository;
};

type EventFilter = (event: any) => boolean;

/**
 * Creates an event queue that buffers events from an EventEmitter
 * and provides an async iterator to consume them.
 */
function createEventQueue(
  emitter: EventEmitter,
  eventName: string,
  filter?: EventFilter,
) {
  const queue: any[] = [];
  let resolver: ((value: any) => void) | null = null;

  const listener = (event: any) => {
    if (filter && !filter(event)) return;

    if (resolver) {
      resolver(event);
      resolver = null;
    } else {
      queue.push(event);
    }
  };

  emitter.on(eventName, listener);

  return {
    next: () =>
      queue.length > 0
        ? Promise.resolve(queue.shift())
        : new Promise((resolve) => {
            resolver = resolve;
          }),
    cleanup: () => emitter.off(eventName, listener),
  };
}

// A single account left open across many tabs/devices is normal; an unbounded
// number is either a bug on the client or someone flooding the server with
// long-lived connections. Chosen generously above real multi-tab usage.
const MAX_STREAM_CONNECTIONS_PER_ACCOUNT = 10;

export default function (deps: BuildRoutesDeps) {
  const { eventEmitter, serviceRepository } = deps;
  // Per-account open-connection count for build-update-stream. Scoped to this
  // route registration (one per running server), not global, so it can't leak
  // across independently constructed servers in tests.
  const openStreamsByAccount = new Map<string, number>();

  return function (server: FastifyInstance, opts: any, done: any) {
    server.addHook("preHandler", (req, res, done) => {
      if (req.session || req.user || req.isApiKeyValid) {
        return done();
      }
      return res.status(403).send("Not Authorized");
    });
    server.get("/build-update-stream", async (req, res) => {
      // Every other stream in this file checks the caller owns what it's
      // asking about (see build-created-stream and new-build-stream below).
      // This one had no such check: build:update carries every account's
      // live deploy activity, so without filtering by accountId, any signed-in
      // client on any account would see every other account's build IDs,
      // service names, environments and statuses stream past.
      const accountId = req.session?.accountId || req.apiKey?.accountId;
      if (!accountId) {
        return res.status(403).send("Not authorized");
      }
      const callerAccountId = accountId.toString();

      const openCount = openStreamsByAccount.get(callerAccountId) ?? 0;
      if (openCount >= MAX_STREAM_CONNECTIONS_PER_ACCOUNT) {
        return res
          .status(429)
          .send("Too many open connections for this account");
      }
      openStreamsByAccount.set(callerAccountId, openCount + 1);
      const releaseConnectionSlot = () => {
        const current = openStreamsByAccount.get(callerAccountId) ?? 1;
        if (current <= 1) openStreamsByAccount.delete(callerAccountId);
        else openStreamsByAccount.set(callerAccountId, current - 1);
      };

      const abortController = new AbortController();
      const buildEnvActionTemplate = Handlebars.compile(
        "{{>buildEnvironmentAction}}",
      );

      // Create a queue to buffer events
      const eventQueue: any[] = [];
      let resolver: ((value: any) => void) | null = null;

      const listener = (updatedBuildEvents: any[]) => {
        for (const event of updatedBuildEvents) {
          if (event.accountId !== callerAccountId) continue;
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
                  serviceId: event.serviceId,
                  status: event.status,
                  deployedAt: event.deployedAt,
                  deployedBy: event.deployedBy,
                  canDispatch: event.canDispatch,
                  isOobSwap: true,
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
        releaseConnectionSlot();
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

      const eventQueue = createEventQueue(
        eventEmitter,
        "build:created",
        (e) => e.serviceId === serviceId,
      );

      res.sse(
        (async function* () {
          try {
            yield {
              event: "connected",
              data: JSON.stringify({ status: "ready" }),
            };

            while (true) {
              const event = await eventQueue.next();
              yield {
                event: "build:created",
                data: JSON.stringify({
                  serviceName: event.serviceName,
                  buildId: event.buildId,
                }),
              };
            }
          } finally {
            eventQueue.cleanup();
          }
        })(),
      );

      req.socket.on("close", () => eventQueue.cleanup());
    });

    // SSE endpoint for streaming new builds to dashboard
    server.get("/new-build-stream/:serviceName", async (req, res) => {
      const { serviceName } = req.params as { serviceName: string };

      // Verify the user owns a service with this name
      const accountId = req.session?.accountId;
      if (!accountId) {
        return res.status(403).send("Not authorized");
      }

      const services = await serviceRepository.findByAccountId(
        new ObjectId(accountId),
      );
      const service = services.find((s) => s.name === serviceName);
      if (!service) {
        return res.status(404).send("Service not found");
      }

      const buildRowTemplate = Handlebars.compile("{{> buildRow}}");
      const eventQueue = createEventQueue(
        eventEmitter,
        "build:created",
        (e) => e.serviceName === serviceName,
      );

      res.sse(
        (async function* () {
          try {
            yield {
              event: "connected",
              data: JSON.stringify({ status: "ready" }),
            };

            while (true) {
              const event = await eventQueue.next();

              // Render the new build row
              const environments = [...service.environments]
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .map((e) => ({ name: e.name }));

              const buildData = {
                build: {
                  id: event.buildId,
                  message: event.message,
                  serviceName,
                  serviceId: service._id.toString(),
                  createdAt: new Date(),
                  deployments: {},
                  environments,
                },
                environments,
                serviceName,
                serviceId: service._id.toString(),
                repoUrl: service.repoUrl || "",
                canDispatch: service.deployment != null,
              };

              const html = buildRowTemplate(buildData);

              yield {
                event: "new-build",
                data: JSON.stringify({
                  buildId: event.buildId,
                  html,
                }),
              };
            }
          } finally {
            eventQueue.cleanup();
          }
        })(),
      );

      req.socket.on("close", () => eventQueue.cleanup());
    });

    done();
  };
}
