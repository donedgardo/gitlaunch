import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { BuildRepository } from "../../../repositories/buildRepository";
import { AnalyticsService } from "../../../services/analytics/analytics";

export type SetupRoutesDeps = {
  buildSimulationEnabled: boolean;
  serviceRepo: ServiceRepository;
  buildRepo: BuildRepository;
  analytics?: AnalyticsService;
};

const TOTAL_STEPS = 5;

export function registerSetupRoutes(
  app: FastifyInstance,
  deps: SetupRoutesDeps,
): void {
  const { serviceRepo, buildRepo, analytics, buildSimulationEnabled } = deps;

  app.get<{ Params: { serviceName: string; step: string } }>(
    "/dashboard/:serviceName/setup/:step",
    async (
      request: FastifyRequest<{
        Params: { serviceName: string; step: string };
      }>,
      reply: FastifyReply,
    ) => {
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      const step = parseInt(request.params.step, 10);
      if (isNaN(step) || step < 1 || step > TOTAL_STEPS) {
        return reply.status(404).send("Step not found");
      }

      const accountId = new ObjectId(request.session.accountId);
      const services = await serviceRepo.findByAccountId(accountId);
      const service = services.find(
        (s) => s.name === request.params.serviceName,
      );

      if (!service) {
        return reply.status(404).send("Service not found");
      }

      const environments = [...service.environments].sort(
        (a, b) => a.order - b.order,
      );

      const { total } = await buildRepo.findPaginated(
        accountId,
        service._id,
        1,
        1,
      );
      const hasBuilds = total > 0;

      analytics?.track("onboarding_step_completed", {
        step,
        serviceName: service.name,
      });

      return reply.view(
        "partials/setupStep",
        {
          step,
          totalSteps: TOTAL_STEPS,
          serviceId: service._id.toString(),
          serviceName: service.name,
          environments,
          hasBuilds,
          showSimulateBuild: buildSimulationEnabled,
        },
        { layout: "" },
      );
    },
  );
}
