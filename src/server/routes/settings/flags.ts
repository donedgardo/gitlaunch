import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { FlagServiceI } from "../../../services/flag/flagService";
import { Flag } from "../../../repositories/flagRepository";
import { AnalyticsService } from "../../../services/analytics/analytics";

export type FlagsSettingsDeps = {
  serviceRepository: ServiceRepository;
  flagService: FlagServiceI;
  analytics?: AnalyticsService;
};

// View model that flattens a flag's per-environment config into rows the
// template can iterate, ordered to match the service's environment order.
function toFlagView(flag: Flag, envNames: string[]) {
  return {
    key: flag.key,
    description: flag.description,
    environments: envNames.map((name) => {
      const cfg = flag.environments[name] ?? {
        enabled: false,
        rolloutPercentage: 0,
        variants: [],
      };
      return {
        name,
        enabled: cfg.enabled,
        rolloutPercentage: cfg.rolloutPercentage,
        variantSummary: cfg.variants.length
          ? cfg.variants.map((v) => `${v.key} ${v.weight}%`).join(" / ")
          : null,
      };
    }),
  };
}

export function registerFlagsSettingsRoutes(
  app: FastifyInstance,
  deps: FlagsSettingsDeps,
): void {
  const { serviceRepository, flagService, analytics } = deps;

  async function loadServiceWithAuth(
    request: FastifyRequest<{ Params: { serviceId: string } }>,
    reply: FastifyReply,
  ) {
    if (!request.session) {
      reply.redirect("/auth/github");
      return null;
    }
    const accountId = new ObjectId(request.session.accountId);
    let serviceObjectId: ObjectId;
    try {
      serviceObjectId = new ObjectId(request.params.serviceId);
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

  function envNamesOf(service: {
    environments: { name: string; order: number }[];
  }): string[] {
    return [...service.environments]
      .sort((a, b) => a.order - b.order)
      .map((e) => e.name);
  }

  async function renderList(
    accountId: ObjectId,
    serviceId: ObjectId,
    envNames: string[],
    reply: FastifyReply,
    error?: string,
  ) {
    const flags = await flagService.listFlags(accountId, serviceId);
    return reply.view("partials/flagList", {
      flags: flags.map((f) => toFlagView(f, envNames)),
      environments: envNames,
      serviceId: serviceId.toString(),
      error,
    });
  }

  // GET /services/:serviceId/flags — management page
  app.get<{ Params: { serviceId: string } }>(
    "/services/:serviceId/flags",
    async (request, reply) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;
      const { service, accountId } = result;
      const envNames = envNamesOf(service);
      const flags = await flagService.listFlags(accountId, service._id);
      const services = await serviceRepository.findByAccountId(accountId);

      return reply.view(
        "settings/flags",
        {
          title: `${service.name} Feature Flags`,
          serviceId: service._id.toString(),
          serviceName: service.name,
          environments: envNames,
          flags: flags.map((f) => toFlagView(f, envNames)),
          services: services.map((s) => s.name),
          activeService: service.name,
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /services/:serviceId/flags — create (HTMX → flagList partial)
  app.post<{
    Params: { serviceId: string };
    Body: { key?: string; description?: string };
  }>("/services/:serviceId/flags", async (request, reply) => {
    const result = await loadServiceWithAuth(request, reply);
    if (!result) return;
    const { service, accountId } = result;
    const envNames = envNamesOf(service);
    const key = (request.body?.key ?? "").trim();

    try {
      await flagService.createFlag(accountId, service._id, {
        key,
        description: (request.body?.description ?? "").trim(),
      });
      analytics?.track("flag_created", {
        serviceId: service._id.toString(),
        key,
      });
      return renderList(accountId, service._id, envNames, reply);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create flag";
      return renderList(accountId, service._id, envNames, reply, message);
    }
  });

  // PATCH /services/:serviceId/flags/:key/environments/:env — configure (HTMX)
  app.patch<{
    Params: { serviceId: string; key: string; env: string };
    Body: { enabled?: string; rolloutPercentage?: string };
  }>(
    "/services/:serviceId/flags/:key/environments/:env",
    async (request, reply) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;
      const { service, accountId } = result;
      const envNames = envNamesOf(service);
      const { key, env } = request.params;

      // Unchecked checkboxes are omitted from the form body, so absence => off.
      const enabled = request.body?.enabled === "true";
      const rolloutPercentage =
        request.body?.rolloutPercentage !== undefined
          ? parseInt(request.body.rolloutPercentage, 10)
          : undefined;

      try {
        await flagService.setEnvConfig(accountId, service._id, key, env, {
          enabled,
          ...(rolloutPercentage !== undefined ? { rolloutPercentage } : {}),
        });
        analytics?.track("flag_updated", {
          serviceId: service._id.toString(),
          key,
          environment: env,
        });
        return renderList(accountId, service._id, envNames, reply);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update flag";
        return renderList(accountId, service._id, envNames, reply, message);
      }
    },
  );

  // DELETE /services/:serviceId/flags/:key — delete (HTMX)
  app.delete<{ Params: { serviceId: string; key: string } }>(
    "/services/:serviceId/flags/:key",
    async (request, reply) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;
      const { service, accountId } = result;
      const envNames = envNamesOf(service);

      await flagService.deleteFlag(accountId, service._id, request.params.key);
      return renderList(accountId, service._id, envNames, reply);
    },
  );
}
