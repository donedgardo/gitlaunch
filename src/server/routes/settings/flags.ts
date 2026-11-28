import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { FlagServiceI } from "../../../services/flag/flagService";
import {
  Flag,
  FlagVariant,
  TargetingCondition,
  TargetingOperator,
  TargetingRule,
} from "../../../repositories/flagRepository";
import { AnalyticsService } from "../../../services/analytics/analytics";
import { actor } from "../../../services/analytics/actorIdentity";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";
import { ExperimentResultsService } from "../../../services/flag/experimentResultsService";
import { toExperimentPanelsView } from "../../../services/analytics/experimentPanelView";
import { BundlePublisherI } from "../../../services/flag/bundlePublisher";
import { buildConfigBundle } from "../../../services/flag/configBundle";

import { ActorDirectory } from "../../../services/account/actorDirectory";

export type FlagsSettingsDeps = {
  publicUrl: string;
  serviceRepository: ServiceRepository;
  flagService: FlagServiceI;
  // Mints least-privilege (flags:read only) keys for the "Connect an app" panel.
  apiKeyService: ApiKeyService;
  analytics?: AnalyticsService;
  // Names the signed-in person on every flag change they make here.
  actors: ActorDirectory;
  experimentResults?: ExperimentResultsService;
  // Both absent unless R2 is configured (see loadConfig's features.flagBundles)
  // — the panel simply doesn't offer a bundle URL when either is missing.
  bundlePublisher?: BundlePublisherI;
  bundlePublicBaseUrl?: string;
};

// Default experiment results window shown in the UI: the last 30 days.
const RESULTS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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

// The targeting editor posts one flat set of fields per form, because HTML
// forms cannot nest. Conditions name the rule they belong to (`condRule`), so
// several of them AND into a single rule while every row stays a sibling.
type TargetingFormBody = {
  ruleIndex?: string | string[];
  ruleServe?: string | string[];
  condRule?: string | string[];
  condAttribute?: string | string[];
  condOperator?: string | string[];
  condValues?: string | string[];
};

// A condition's values are typed as one comma-separated field, mirroring how
// the summary renders them, so a rule round-trips through the form unchanged.
function parseConditionValues(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

// Zips the flat form fields back into targeting rules, preserving the order the
// rules were rendered in — first match wins at evaluation time. Rows without an
// attribute or without values are dropped (the "add" affordances leave blank
// rows behind), and a rule whose conditions all dropped out goes with them, so
// clearing a rule's last condition removes the rule rather than failing the
// save. Operators are passed through for FlagService to validate.
function parseTargetingRules(body: TargetingFormBody): TargetingRule[] {
  const ruleIndexes = toArray(body.ruleIndex);
  const serves = toArray(body.ruleServe);
  const condRules = toArray(body.condRule);
  const attributes = toArray(body.condAttribute);
  const operators = toArray(body.condOperator);
  const values = toArray(body.condValues);

  const conditionsByRule = new Map<string, TargetingCondition[]>();
  for (let i = 0; i < condRules.length; i++) {
    const attribute = (attributes[i] ?? "").trim();
    const conditionValues = parseConditionValues(values[i]);
    if (!attribute || conditionValues.length === 0) continue;
    const existing = conditionsByRule.get(condRules[i]) ?? [];
    existing.push({
      attribute,
      operator: (operators[i] ?? "").trim() as TargetingOperator,
      values: conditionValues,
    });
    conditionsByRule.set(condRules[i], existing);
  }

  const rules: TargetingRule[] = [];
  for (let i = 0; i < ruleIndexes.length; i++) {
    const conditions = conditionsByRule.get(ruleIndexes[i]);
    if (!conditions?.length) continue;
    const serve = (serves[i] ?? "").trim();
    rules.push({ conditions, serve: serve === "" ? null : serve });
  }
  return rules;
}

// The "serve" choices for one rule: plain on, plus every variant defined in
// this environment. A rule pointing at a variant that has since been deleted
// keeps that value as an option, so re-saving another rule cannot silently
// rewrite it — the server rejects the save until someone fixes it.
function serveOptions(variants: FlagVariant[], serve: string | null) {
  const keys = variants.map((v) => v.key);
  if (serve && !keys.includes(serve)) keys.push(serve);
  return [
    { value: "", label: "on", selected: serve === null },
    ...keys.map((key) => ({ value: key, label: key, selected: serve === key })),
  ];
}

// Rules as the editor renders them: a stable index the condition rows point
// back at, and values flattened to the comma-separated text the form takes.
function toTargetingRuleViews(rules: TargetingRule[], variants: FlagVariant[]) {
  return rules.map((rule, index) => ({
    index,
    conditions: rule.conditions.map((c) => ({
      attribute: c.attribute,
      operator: c.operator,
      values: c.values.join(", "),
    })),
    serveOptions: serveOptions(variants, rule.serve),
  }));
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
        targetingRules: toTargetingRuleViews(
          cfg.targetingRules ?? [],
          cfg.variants,
        ),
        // Options for a rule the customer has not added yet, so the blank row
        // the "Add rule" button clones offers this environment's variants.
        blankServeOptions: serveOptions(cfg.variants, null),
      };
    }),
  };
}

export function registerFlagsSettingsRoutes(
  app: FastifyInstance,
  deps: FlagsSettingsDeps,
): void {
  const {
    publicUrl,
    serviceRepository,
    flagService,
    apiKeyService,
    analytics,
    actors,
    experimentResults,
    bundlePublisher,
    bundlePublicBaseUrl,
  } = deps;

  // Base URL for the copy-paste integration snippets. Empty in dev/tests keeps
  // the endpoint path (with serviceId) intact — the panel is still useful.
  const apiUrl = publicUrl;

  const bundlingEnabled = Boolean(bundlePublisher && bundlePublicBaseUrl);

  function bundleUrlFor(slug: string, envName: string): string {
    return `${bundlePublicBaseUrl}/flags/${slug}/${envName}.json`;
  }

  // Publishes the current config directly (bypassing FlagConfigVersionService's
  // history/dedup — this isn't a config change, so it shouldn't mint a
  // version), so a service whose flags haven't changed recently — or whose
  // slug was just rotated — still has working bundles for every environment
  // the moment someone looks at this page. Best-effort: a failure here must
  // never break the page that's showing the URL.
  async function publishBundlesForAllEnvs(
    accountId: ObjectId,
    serviceId: ObjectId,
    slug: string,
    envNames: string[],
  ): Promise<void> {
    if (!bundlePublisher) return;
    try {
      const flags = await flagService.listFlags(accountId, serviceId);
      for (const envName of envNames) {
        await bundlePublisher.publish(
          slug,
          envName,
          buildConfigBundle(flags, envName),
        );
      }
    } catch {
      // Best-effort — see comment above.
    }
  }

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
    return { service, accountId, userId: new ObjectId(request.session.userId) };
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
      const evaluateEnv = envNames[0] ?? "prod";

      let bundleUrl: string | null = null;
      if (bundlingEnabled) {
        const slug = await serviceRepository.ensureFlagPublishSlug(service._id);
        await publishBundlesForAllEnvs(accountId, service._id, slug, envNames);
        bundleUrl = bundleUrlFor(slug, evaluateEnv);
      }

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
          evaluateEnv,
          bundleUrl,
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
      const { service, accountId, userId } = result;
      const envNames = envNamesOf(service);

      const { key } = await apiKeyService.generate({
        accountId,
        createdByUserId: userId,
        name: `Flag reader — ${service.name}`,
        scopes: ["flags:read"],
      });
      analytics?.track(
        "flag_client_key_created",
        { serviceId: service._id.toString() },
        actor(accountId, userId),
      );

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

  // POST /services/:serviceId/flags/keys/browser — mint a publishable key for a
  // web app that evaluates flags client-side. Unlike the server-side key above,
  // this one is expected to be readable by anyone who loads the page, so it is
  // confined to a single service + environment, evaluate-only, and usable only
  // from the origins named here.
  app.post<{
    Params: { serviceId: string };
    Body: { environment?: string; origins?: string };
  }>("/services/:serviceId/flags/keys/browser", async (request, reply) => {
    const result = await loadServiceWithAuth(request, reply);
    if (!result) return;
    const { service, accountId, userId } = result;
    const envNames = envNamesOf(service);

    const environment = (request.body?.environment ?? "").trim() || envNames[0];
    // Accept a comma- or newline-separated list, the way people paste origins.
    const origins = (request.body?.origins ?? "")
      .split(/[\s,]+/)
      .map((o) => o.trim())
      .filter(Boolean);

    if (!origins.length) {
      return reply
        .status(400)
        .send("Name at least one origin this key may be used from.");
    }
    if (!environment) {
      return reply
        .status(400)
        .send("Pick the environment this key should evaluate.");
    }

    const { key } = await apiKeyService.generate({
      accountId,
      createdByUserId: userId,
      name: `Browser key — ${service.name} (${environment})`,
      scopes: ["flags:evaluate"],
      kind: "publishable",
      serviceId: service._id,
      environment,
      allowedOrigins: origins,
    });
    analytics?.track(
      "flag_browser_key_created",
      {
        serviceId: service._id.toString(),
        environment,
        originCount: origins.length,
      },
      actor(accountId, userId),
    );

    let bundleUrl: string | null = null;
    if (bundlingEnabled) {
      const slug = await serviceRepository.ensureFlagPublishSlug(service._id);
      await publishBundlesForAllEnvs(accountId, service._id, slug, envNames);
      bundleUrl = bundleUrlFor(slug, environment);
    }

    return reply.view(
      "partials/flagKeyResult",
      {
        newKey: key,
        serviceId: service._id.toString(),
        evaluateEnv: environment,
        apiUrl,
        publishable: true,
        allowedOrigins: origins.join(", "),
        bundleUrl,
      },
      { layout: "" },
    );
  });

  // POST /services/:serviceId/flags/bundle/rotate — mint a fresh publish slug
  // (HTMX). The bundle URL is meant to be public — it ships in a customer's
  // frontend, same as their compiled JS — so this isn't for "when it leaks."
  // It's for retiring a URL on purpose (a decommissioned build, an
  // environment nobody publishes to anymore). The old URL is orphaned, not
  // deleted — nothing can construct it once the slug isn't retrievable.
  app.post<{ Params: { serviceId: string } }>(
    "/services/:serviceId/flags/bundle/rotate",
    async (request, reply) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;
      const { service, accountId, userId } = result;
      const envNames = envNamesOf(service);
      const evaluateEnv = envNames[0] ?? "prod";

      const slug = await serviceRepository.rotateFlagPublishSlug(
        accountId,
        service._id,
      );
      await publishBundlesForAllEnvs(accountId, service._id, slug, envNames);
      analytics?.track(
        "flag_bundle_slug_rotated",
        { serviceId: service._id.toString() },
        actor(accountId, userId),
      );

      return reply.view("partials/flagBundleUrl", {
        serviceId: service._id.toString(),
        bundleUrl: bundlingEnabled ? bundleUrlFor(slug, evaluateEnv) : null,
      });
    },
  );

  // POST /services/:serviceId/flags — create (HTMX → flagList partial)
  app.post<{
    Params: { serviceId: string };
    Body: { key?: string; description?: string };
  }>("/services/:serviceId/flags", async (request, reply) => {
    const result = await loadServiceWithAuth(request, reply);
    if (!result) return;
    const { service, accountId, userId } = result;
    const envNames = envNamesOf(service);
    const key = (request.body?.key ?? "").trim();

    try {
      await flagService.createFlag(
        accountId,
        service._id,
        {
          key,
          description: (request.body?.description ?? "").trim(),
        },
        { actor: await actors.forUser(result.userId) },
      );
      analytics?.track(
        "flag_created",
        { serviceId: service._id.toString(), key },
        actor(accountId, userId),
      );
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
      const { service, accountId, userId } = result;
      const envNames = envNamesOf(service);
      const { key, env } = request.params;

      // Unchecked checkboxes are omitted from the form body, so absence => off.
      const enabled = request.body?.enabled === "true";
      const rolloutPercentage =
        request.body?.rolloutPercentage !== undefined
          ? parseInt(request.body.rolloutPercentage, 10)
          : undefined;

      try {
        await flagService.setEnvConfig(
          accountId,
          service._id,
          key,
          env,
          {
            enabled,
            ...(rolloutPercentage !== undefined ? { rolloutPercentage } : {}),
          },
          { actor: await actors.forUser(result.userId) },
        );
        analytics?.track(
          "flag_updated",
          { serviceId: service._id.toString(), key, environment: env },
          actor(accountId, userId),
        );
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
      const { service, accountId, userId } = result;
      const envNames = envNamesOf(service);
      const { key, env } = request.params;

      const variants = parseVariants(
        request.body?.variantKey,
        request.body?.variantWeight,
      );

      try {
        await flagService.setEnvConfig(
          accountId,
          service._id,
          key,
          env,
          {
            variants,
          },
          { actor: await actors.forUser(result.userId) },
        );
        analytics?.track(
          "flag_updated",
          { serviceId: service._id.toString(), key, environment: env },
          actor(accountId, userId),
        );
        return renderList(accountId, service._id, envNames, reply);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update variants";
        return renderList(accountId, service._id, envNames, reply, message);
      }
    },
  );

  // PUT /services/:serviceId/flags/:key/environments/:env/targeting — edit the
  // targeting rules for one environment (HTMX). Submitting no rows clears them,
  // putting the environment back on the plain rollout gate.
  app.put<{
    Params: { serviceId: string; key: string; env: string };
    Body: TargetingFormBody;
  }>(
    "/services/:serviceId/flags/:key/environments/:env/targeting",
    async (request, reply) => {
      const result = await loadServiceWithAuth(request, reply);
      if (!result) return;
      const { service, accountId, userId } = result;
      const envNames = envNamesOf(service);
      const { key, env } = request.params;

      const targetingRules = parseTargetingRules(request.body ?? {});

      try {
        await flagService.setEnvConfig(
          accountId,
          service._id,
          key,
          env,
          {
            targetingRules,
          },
          { actor: await actors.forUser(result.userId) },
        );
        analytics?.track(
          "flag_updated",
          { serviceId: service._id.toString(), key, environment: env },
          actor(accountId, userId),
        );
        return renderList(accountId, service._id, envNames, reply);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update targeting";
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

      await flagService.deleteFlag(accountId, service._id, request.params.key, {
        actor: await actors.forUser(result.userId),
      });
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

      if (!experimentResults) {
        return reply.view("partials/experimentResults", {
          disabled: true,
          flagKey: key,
        });
      }

      // No environment is named: environments run in parallel, so an experiment
      // may be live in any of them, and the panel reports every one that has
      // data rather than guessing at a "final" one.
      const to = new Date();
      const from = new Date(to.getTime() - RESULTS_WINDOW_MS);
      const results = await experimentResults.getResultsByEnvironment({
        accountId,
        serviceId: service._id,
        flagKey: key,
        from,
        to,
      });

      return reply.view(
        "partials/experimentResults",
        toExperimentPanelsView(key, results),
      );
    },
  );
}
