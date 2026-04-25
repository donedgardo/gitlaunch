import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../../repositories/serviceRepository";

export type SetupRoutesDeps = {
  serviceRepo: ServiceRepository;
};

const TOTAL_STEPS = 5;

export function registerSetupRoutes(
  app: FastifyInstance,
  deps: SetupRoutesDeps,
): void {
  const { serviceRepo } = deps;

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

      return reply.view(
        "partials/setupStep",
        {
          step,
          totalSteps: TOTAL_STEPS,
          serviceId: service._id.toString(),
          serviceName: service.name,
          environments,
          showSimulateBuild: process.env.USE_FAKE_GITHUB === "true",
        },
        { layout: "" },
      );
    },
  );
}
