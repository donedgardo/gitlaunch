import { ObjectId } from "mongodb";
import { ReleaseArtifact } from "./release";
import { planPromotion } from "./planPromotion";
import {
  CreateReleaseResult,
  ReleaseRepository,
} from "../../repositories/releaseRepository";
import {
  DesiredRelease,
  DesiredReleaseRepository,
} from "../../repositories/desiredReleaseRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";

export type CutReleaseInput = {
  accountId: ObjectId;
  serviceId: ObjectId;
  version: string;
  commitSha: string;
  artifacts: ReleaseArtifact[];
};

export type PromoteInput = {
  accountId: ObjectId;
  serviceId: ObjectId;
  version: string;
  environment: string;
};

export type PromoteResult =
  | { promoted: true; desired: DesiredRelease }
  | { promoted: false; reason: string };

// The imperative shell around the promotion core: it loads the service's
// environments and the current desired state, lets planPromotion decide, and
// only then writes. Nothing is dispatched — the write *is* the deploy, and the
// agent owning that environment picks it up on its next poll.
export class ReleaseService {
  constructor(
    private releases: ReleaseRepository,
    private desired: DesiredReleaseRepository,
    private services: ServiceRepository,
  ) {}

  async cutRelease(input: CutReleaseInput): Promise<CreateReleaseResult> {
    const service = await this.services.findByAccountAndId(
      input.accountId,
      input.serviceId,
    );
    if (!service) {
      return { created: false, reason: "Service not found" };
    }
    return this.releases.create(input);
  }

  async promote(input: PromoteInput): Promise<PromoteResult> {
    const service = await this.services.findByAccountAndId(
      input.accountId,
      input.serviceId,
    );
    if (!service) {
      return { promoted: false, reason: "Service not found" };
    }

    const release = await this.releases.findByVersion(
      input.accountId,
      input.serviceId,
      input.version,
    );
    if (!release) {
      return {
        promoted: false,
        reason: `Release ${input.version} does not exist`,
      };
    }

    const desiredVersions = await this.desired.desiredVersions(
      input.accountId,
      input.serviceId,
    );
    const plan = planPromotion(
      release,
      input.environment,
      service.environments,
      desiredVersions,
    );
    if (plan.kind === "promotion-blocked") {
      return { promoted: false, reason: plan.reason };
    }

    const desired = await this.desired.setDesired({
      accountId: input.accountId,
      serviceId: input.serviceId,
      environment: plan.environment,
      version: plan.version,
    });
    return { promoted: true, desired };
  }
}
