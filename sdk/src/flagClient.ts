// GitLaunch feature flag client.
//
// Wraps the two runtime endpoints an application actually calls — evaluate and
// conversions — with the three things every caller would otherwise reimplement:
// one round trip per entity instead of one per flag, a bounded wait, and an
// answer even when GitLaunch is unreachable.
//
// No dependencies, no globals: it runs on a server (Node 18+) with a secret key
// or in a browser with a publishable key.

export type FlagDecision = {
  enabled: boolean;
  variant: string | null;
  reason: string;
};

export type FlagAttributes = Record<string, string | number | boolean>;

export type FlagContext = {
  // A stable identifier for whoever is being bucketed — a user id, an account
  // id, an anonymous visitor cookie. The same entity always lands in the same
  // bucket, so a user's experience does not flip between page loads.
  entity: string;
  // Values targeting rules can match on (plan, country, githubLogin, …).
  attributes?: FlagAttributes;
};

export type ConversionContext = FlagContext & {
  goal?: string;
  value?: number;
};

export type FlagClientOptions = {
  // Where GitLaunch lives, e.g. "https://gitlaunch.dev".
  apiUrl: string;
  serviceId: string;
  environment: string;
  // A secret key (sk_…) on a server, or a publishable key (pk_…) in a browser.
  apiKey: string;
  // How long a set of decisions may be reused before it is re-fetched.
  ttlMs?: number;
  // How long to wait for GitLaunch before falling back. A flag check sits in
  // front of a feature; it must never be what makes a page slow.
  timeoutMs?: number;
  onError?: (error: unknown) => void;
  fetch?: typeof fetch;
  now?: () => number;
};

export type FlagClient = {
  isEnabled(
    key: string,
    context: FlagContext,
    fallback?: boolean,
  ): Promise<boolean>;
  variant(
    key: string,
    context: FlagContext,
    fallback?: string | null,
  ): Promise<string | null>;
  evaluate(context: FlagContext): Promise<Record<string, FlagDecision>>;
  track(key: string, context: ConversionContext): Promise<boolean>;
  refresh(context: FlagContext): Promise<Record<string, FlagDecision>>;
};

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 1_500;

type CacheEntry = {
  decisions: Record<string, FlagDecision>;
  fetchedAt: number;
};

export function createFlagClient(options: FlagClientOptions): FlagClient {
  const {
    apiUrl,
    serviceId,
    environment,
    apiKey,
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onError,
    fetch: fetchImpl = globalThis.fetch,
    now = () => Date.now(),
  } = options;

  if (!fetchImpl) {
    throw new Error(
      "No fetch available. Pass one via `fetch` (Node 18+ has it built in).",
    );
  }

  const base = `${apiUrl.replace(/\/+$/, "")}/api/v1/services/${serviceId}/environments/${encodeURIComponent(environment)}`;
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<Record<string, FlagDecision>>>();

  // Attributes are part of the identity of a decision, not decoration: the same
  // user on a different plan can match a different targeting rule.
  function cacheKeyOf(context: FlagContext): string {
    const attributes = context.attributes ?? {};
    const stable = Object.keys(attributes)
      .sort()
      .map((name) => `${name}=${String(attributes[name])}`)
      .join("&");
    return `${context.entity}|${stable}`;
  }

  function report(error: unknown) {
    if (!onError) return;
    try {
      onError(error);
    } catch {
      // A broken error handler must not take down the feature it reports on.
    }
  }

  async function request(url: string, init: RequestInit = {}): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw new Error(`GitLaunch flags responded ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchDecisions(
    context: FlagContext,
  ): Promise<Record<string, FlagDecision>> {
    const url = new URL(`${base}/flags/evaluate`);
    url.searchParams.set("entity", context.entity);
    for (const [name, value] of Object.entries(context.attributes ?? {})) {
      url.searchParams.set(`attr.${name}`, String(value));
    }
    const body = await request(url.toString());
    return (body?.flags ?? {}) as Record<string, FlagDecision>;
  }

  async function load(
    context: FlagContext,
    force: boolean,
  ): Promise<Record<string, FlagDecision>> {
    const cacheKey = cacheKeyOf(context);
    const cached = cache.get(cacheKey);
    if (!force && cached && now() - cached.fetchedAt < ttlMs) {
      return cached.decisions;
    }

    const pending = inFlight.get(cacheKey);
    if (pending) return pending;

    const loading = fetchDecisions(context)
      .then((decisions) => {
        cache.set(cacheKey, { decisions, fetchedAt: now() });
        return decisions;
      })
      .catch((error) => {
        report(error);
        // Serve the last decisions we did get. During an outage they are far
        // closer to the truth than flipping every entity to its fallback, and
        // they are what the entity already saw.
        if (cached) return cached.decisions;
        return {} as Record<string, FlagDecision>;
      })
      .finally(() => {
        inFlight.delete(cacheKey);
      });

    inFlight.set(cacheKey, loading);
    return loading;
  }

  async function decisionFor(
    key: string,
    context: FlagContext,
  ): Promise<FlagDecision | undefined> {
    const decisions = await load(context, false);
    return decisions[key];
  }

  return {
    async isEnabled(key, context, fallback = false) {
      const decision = await decisionFor(key, context);
      return decision ? decision.enabled : fallback;
    },

    async variant(key, context, fallback = null) {
      const decision = await decisionFor(key, context);
      if (!decision) return fallback;
      return decision.variant ?? fallback;
    },

    evaluate(context) {
      return load(context, false);
    },

    refresh(context) {
      return load(context, true);
    },

    // Records the conversion that closes an experiment. The variant is
    // attributed server-side by re-evaluating the flag, so there is no variant
    // to pass and no way to report the wrong one. Never throws: a feature must
    // not break because its measurement did.
    async track(key, context) {
      const attributes = context.attributes ?? {};
      try {
        await request(`${base}/flags/${encodeURIComponent(key)}/conversions`, {
          method: "POST",
          body: JSON.stringify({
            entity: context.entity,
            ...(context.goal !== undefined ? { goal: context.goal } : {}),
            ...(context.value !== undefined ? { value: context.value } : {}),
            ...(Object.keys(attributes).length ? { attributes } : {}),
          }),
        });
        return true;
      } catch (error) {
        report(error);
        return false;
      }
    },
  };
}
