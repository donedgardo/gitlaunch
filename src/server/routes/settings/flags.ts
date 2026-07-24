import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { FlagServiceI } from "../../../services/flag/flagService";
import {
  Flag,
  FlagVariant,
  TargetingRule,
} from "../../../repositories/flagRepository";
import { AnalyticsService } from "../../../services/analytics/analytics";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import {
  ExperimentResultsService,
  ExperimentResults,
} from "../../../services/flag/experimentResultsService";

export type FlagsSettingsDeps = {
  serviceRepository: ServiceRepository;
  flagService: FlagServiceI;
  // Mints least-privilege (flags:read only) keys for the "Connect an app" panel.
  apiKeyService: ApiKeyService;
  analytics?: AnalyticsService;
  experimentResults?: ExperimentResultsService;
};

// Default experiment results window shown in the UI: the last 30 days.
const RESULTS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Flatten the results into template-friendly rows: a formatted percentage plus
// a bar width (relative to the best-performing variant) for the inline chart.
function toResultsView(results: ExperimentResults) {
  const best = results.variants.reduce(
    (max, v) => Math.max(max, v.conversionRate),
    0,
  );
  return {
    flagKey: results.flagKey,
    environment: results.environment,
    hasData: results.totals.exposures > 0,
    totals: {
      exposures: results.totals.exposures,
      conversions: results.totals.conversions,
      conversionRatePct: (results.totals.conversionRate * 100).toFixed(1),
    },
    variants: results.variants.map((v) => ({
      variant: v.variant,
      exposures: v.exposures,
      conversions: v.conversions,
      conversionRatePct: (v.conversionRate * 100).toFixed(1),
      barPct: best > 0 ? Math.round((v.conversionRate / best) * 100) : 0,
    })),
  };
}

// Normalizes a form field that fast-querystring returns as a string (single
// value), an array (repeated), or undefined (absent) into a plain array.
function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// Zips the parallel variantKey/variantWeight form fields back into variants,
// dropping blank rows (a cleared key means the user removed that variant, and
// the "add variant" affordance can leave a trailing empty row). Weights are
// left for FlagService to validate (a blank weight becomes NaN → rejected).
function parseVariants(
  rawKeys: string | string[] | undefined,
  rawWeights: string | string[] | undefined,
): FlagVariant[] {
  const keys = toArray(rawKeys);
  const weights = toArray(rawWeights);
  const variants: FlagVariant[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = (keys[i] ?? "").trim();
    if (!key) continue;
    const rawWeight = (weights[i] ?? "").trim();
    variants.push({ key, weight: rawWeight === "" ? NaN : Number(rawWeight) });
  }
  return variants;
}

// Human-readable one-liner for a targeting rule, e.g.
// "country in US, CA → treatment". Multiple rules are joined with "; ".
const OPERATOR_LABELS: Record<
  TargetingRule["conditions"][number]["operator"],
  string
> = {
  eq: "=",
  neq: "≠",
  in: "in",
  not_in: "not in",
  contains: "contains",
};

function summarizeTargetingRules(rules: TargetingRule[]): string | null {
  if (!rules.length) return null;
  return rules
    .map((rule) => {
      const conditions = rule.conditions
        .map(
          (c) =>
            `${c.attribute} ${OPERATOR_LABELS[c.operator]} ${c.values.join(", ")}`,
        )
        .join(" and ");
      return `${conditions} → ${rule.serve ?? "on"}`;
    })
    .join("; ");
}

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
        targetingRules: [],
      };
      return {
        name,
        enabled: cfg.enabled,
        rolloutPercentage: cfg.rolloutPercentage,
        variants: cfg.variants,
        variantSummary: cfg.variants.length
          ? cfg.variants.map((v) => `${v.key} ${v.weight}%`).join(" / ")
          : null,
        targetingSummary: summarizeTargetingRules(cfg.targetingRules ?? []),
      };
    }),
  };
}

export function registerFlagsSettingsRoutes(
  app: FastifyInstance,
  deps: FlagsSettingsDeps,
): void {
  const {
    serviceRepository,
    flagService,
    apiKeyService,
    analytics,
    experimentResults,
  } = deps;

  // Base URL for the copy-paste integration snippets. Empty in dev/tests keeps
  // the endpoint path (with serviceId) intact — the panel is still useful.
  const apiUrl = process.env.PUBLIC_URL || "";

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
          // "Connect an app" panel: prefilled evaluate endpoint for this service.
          apiUrl,
          evaluateEnv: envNames[0] ?? "prod",
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /services/:serviceId/flags/keys — mint a least-privilege client key
  // (flags:read ONLY) for evaluating this service's flags, shown once (HTMX).
  app.post<{ Params: { serviceId: string } }>(
    "/services/:serviceId/flags/keys",
    async (request, reply) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;
      const { service, accountId } = result;
      const userId = new ObjectId(request.session!.userId);
      const envNames = envNamesOf(service);

      const { key } = await apiKeyService.generate({
        accountId,
        createdByUserId: userId,
        name: `Flag reader — ${service.name}`,
        scopes: ["flags:read"],
      });
      analytics?.track("flag_client_key_created", {
        serviceId: service._id.toString(),
      });

      return reply.view(
        "partials/flagKeyResult",
        {
          newKey: key,
          serviceId: service._id.toString(),
          evaluateEnv: envNames[0] ?? "prod",
          apiUrl,
        },
        { layout: "" },
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

  // PUT /services/:serviceId/flags/:key/environments/:env/variants — edit the
  // A/B variant split for one environment (HTMX). Submitting no rows clears the
  // variants, turning the flag back into a plain boolean/rollout flag.
  app.put<{
    Params: { serviceId: string; key: string; env: string };
    Body: {
      variantKey?: string | string[];
      variantWeight?: string | string[];
    };
  }>(
    "/services/:serviceId/flags/:key/environments/:env/variants",
    async (request, reply) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;
      const { service, accountId } = result;
      const envNames = envNamesOf(service);
      const { key, env } = request.params;

      const variants = parseVariants(
        request.body?.variantKey,
        request.body?.variantWeight,
      );

      try {
        await flagService.setEnvConfig(accountId, service._id, key, env, {
          variants,
        });
        analytics?.track("flag_updated", {
          serviceId: service._id.toString(),
          key,
          environment: env,
        });
        return renderList(accountId, service._id, envNames, reply);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update variants";
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

  // GET /services/:serviceId/flags/:key/results — experiment metrics (HTMX
  // partial). Shows per-variant exposure/conversion rates over the last 30 days
  // for the flag's primary (lowest-order, e.g. prod) environment.
  app.get<{ Params: { serviceId: string; key: string } }>(
    "/services/:serviceId/flags/:key/results",
    async (request, reply) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;
      const { service, accountId } = result;
      const { key } = request.params;

      const flag = await flagService.getFlag(accountId, service._id, key);
      if (!flag) {
        return reply.status(404).send("Flag not found");
      }

      const envNames = envNamesOf(service);
      const environment = envNames[envNames.length - 1] ?? "prod";

      if (!experimentResults) {
        return reply.view("partials/experimentResults", {
          disabled: true,
          flagKey: key,
          environment,
        });
      }

      const to = new Date();
      const from = new Date(to.getTime() - RESULTS_WINDOW_MS);
      const results = await experimentResults.getResults({
        accountId,
        serviceId: service._id,
        flagKey: key,
        environment,
        from,
        to,
      });

      return reply.view("partials/experimentResults", toResultsView(results));
    },
  );
}
