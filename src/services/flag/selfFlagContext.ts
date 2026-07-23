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

// Resolves (once) the account that owns our configured service. A service's
// account never changes, so a successful lookup is memoized; a miss is not, so
// a transient failure retries on the next request.
export class SelfFlagAccount {
  private accountId: ObjectId | null = null;

  constructor(
    private services: ServiceRepository,
    private context: SelfFlagContext,
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
    return this.accountId;
  }
}
