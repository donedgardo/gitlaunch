import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../repositories/serviceRepository";

// GitLaunch is a customer of its own flag service: internal features that
// dogfood flags (landing-page A/B test, signup gate, ...) all live under one
// GitLaunch service and differ only by flag key.
export type SelfFlagContext = {
  // The service our own flags live under, plus which flag environment to read.
  // The account is NOT configured — a service already belongs to one account,
  // so it is derived from serviceId (same as the HTTP flag API, which never
  // asks a caller for an account id). serviceId absent => flags inert.
  serviceId?: ObjectId;
  environment: string;
};

// Why our own flags are (or aren't) live. Every dogfood flag fails open, so a
// half-finished setup is silent by design — nothing breaks, the feature just
// never engages. That silence is a trap when you've just created a flag and are
// waiting for it to bite, so we describe the setup explicitly and log it.
export type SelfFlagStatus = {
  live: boolean;
  // "unset"/"invalid" are setup mistakes; "live" means we will read real flags.
  reason: "live" | "unset" | "invalid";
  message: string;
};

// Takes the raw env value rather than a parsed ObjectId so it can tell "never
// configured" apart from "configured with something that isn't a service id"
// (a slug or a dashboard URL) — which otherwise look identical downstream.
export function describeSelfFlagStatus(
  rawServiceId: string | undefined,
  environment: string,
): SelfFlagStatus {
  const inert =
    "GitLaunch's own feature flags are INERT (self-serve signup gate and " +
    "landing A/B test will behave as if every flag were off-but-open).";
  if (!rawServiceId) {
    return {
      live: false,
      reason: "unset",
      message: `${inert} GITLAUNCH_SERVICE_ID is not set — set it to the service id in your /services/:id/flags URL.`,
    };
  }
  if (!ObjectId.isValid(rawServiceId)) {
    return {
      live: false,
      reason: "invalid",
      message: `${inert} GITLAUNCH_SERVICE_ID="${rawServiceId}" is not a valid service id — expected the 24-character id from your /services/:id/flags URL.`,
    };
  }
  return {
    live: true,
    reason: "live",
    message: `GitLaunch's own feature flags are live: reading service ${rawServiceId} in the "${environment}" flag environment.`,
  };
}

// Resolves (once) the account that owns our configured service. A service's
// account never changes, so a successful lookup is memoized; a miss is not, so
// a transient failure retries on the next request.
export class SelfFlagAccount {
  private accountId: ObjectId | null = null;
  // A configured-but-unresolvable service is the third silent way our flags go
  // inert (right id shape, no such service). Warn, but only once — resolve() is
  // on the request path and would otherwise flood the logs.
  private warned = false;

  constructor(
    private services: ServiceRepository,
    private context: SelfFlagContext,
    // Defaults to the console so the warning reaches production logs without
    // every caller having to thread a logger through; tests inject a spy.
    private warn: (message: string) => void = console.warn,
  ) {}

  get configured(): boolean {
    return !!this.context.serviceId;
  }

  async resolve(): Promise<ObjectId | null> {
    if (this.accountId) return this.accountId;
    if (!this.context.serviceId) return null;
    const service = await this.services
      .findById(this.context.serviceId)
      .catch(() => null);
    if (service?.accountId) this.accountId = service.accountId;
    if (!this.accountId && !this.warned) {
      this.warned = true;
      this.warn(
        `GitLaunch's own feature flags are INERT: no service found for GITLAUNCH_SERVICE_ID=${this.context.serviceId.toString()}.`,
      );
    }
    return this.accountId;
  }
}
