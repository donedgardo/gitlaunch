import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { DoraMetricsService } from "../../../services/dora/doraMetricsService";
import { loadDeliveryMetricsPanel } from "../../../services/dora/deliveryMetricsPanel";

export type MetricsRoutesDeps = {
  serviceRepository: ServiceRepository;
  doraMetricsService: DoraMetricsService;
};

/**
 * The delivery metrics page.
 *
 * The four keys get their own screen rather than a panel on the release board:
 * the board answers "what is live right now", these numbers answer "how well do
 * we get it there". Two different questions, reached the same way the other
 * per-service screens are — an icon next to the active service.
 */
export function registerMetricsRoutes(
  app: FastifyInstance,
  deps: MetricsRoutesDeps,
): void {
  const { serviceRepository, doraMetricsService } = deps;

  async function loadServiceWithAuth(
    request: FastifyRequest<{ Params: { serviceId: string } }>,
    reply: FastifyReply,
  ) {
    if (!request.session) {
      reply.redirect("/auth/github");
      return null;
    }

    const accountId = new ObjectId(request.session.accountId);
    const { serviceId } = request.params;

    let serviceObjectId: ObjectId;
    try {
      serviceObjectId = new ObjectId(serviceId);
    } catch {
      reply.status(400).send("Invalid service ID");
      return null;
    }

    const service = await serviceRepository.findByAccountAndId(
      accountId,
      serviceObjectId,
    );
    if (!service) {
      reply.status(404).send("Service not found");
      return null;
    }

    return { service, accountId };
  }

  // GET /services/:serviceId/metrics - Delivery metrics for one service
  app.get<{ Params: { serviceId: string } }>(
    "/services/:serviceId/metrics",
    async (request, reply) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;

      const { service, accountId } = result;

      const environmentNames = [...service.environments]
        .sort((a, b) => a.order - b.order)
        .map((e) => e.name);

      const doraMetrics = await loadDeliveryMetricsPanel(
        doraMetricsService,
        accountId,
        service._id,
        environmentNames,
      );

      const services = await serviceRepository.findByAccountId(accountId);

      return reply.view(
        "services/metrics",
        {
          title: `${service.name} Delivery Metrics`,
          serviceId: service._id.toString(),
          serviceName: service.name,
          doraMetrics,
          services: services.map((s) => s.name),
          activeService: service.name,
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );
}
