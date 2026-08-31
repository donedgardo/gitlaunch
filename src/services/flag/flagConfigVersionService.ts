import { ObjectId } from "mongodb";
import { FlagRepository } from "../../repositories/flagRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import {
  FlagConfigVersion,
  FlagConfigVersionRepository,
} from "../../repositories/flagConfigVersionRepository";
import { buildConfigBundle, hashConfigBundle } from "./configBundle";
import { BundlePublisherI, NoopBundlePublisher } from "./bundlePublisher";

// Owns the immutable version history of each service+environment's flag config.
// Under the "auto-publish latest" model the runtime always serves current
// flags; this service records what "current" was at each change so the config
// can be audited, diffed, downloaded as a release artifact, and rolled back to.
export interface FlagConfigVersionPublisherI {
  publish(
    accountId: ObjectId,
    serviceId: ObjectId,
    envName: string,
  ): Promise<FlagConfigVersion>;
}

export class FlagConfigVersionService implements FlagConfigVersionPublisherI {
  constructor(
    private flagRepo: FlagRepository,
    private versionRepo: FlagConfigVersionRepository,
    // Optional: resolving a publish slug (and therefore publishing a bundle
    // anywhere a browser SDK can fetch it) only happens when both a service
    // repo and a bundle publisher are available. Omitting either preserves
    // the original version-history-only behavior exactly.
    private serviceRepo?: ServiceRepository,
    private bundlePublisher: BundlePublisherI = new NoopBundlePublisher(),
  ) {}

  // Snapshot the current flags for one environment and append a new immutable
  // version — but only if the config actually changed. Republishing identical
  // config is a no-op that returns the existing latest version (content-hash
  // dedup), so unrelated writes don't inflate the history.
  async publish(
    accountId: ObjectId,
    serviceId: ObjectId,
    envName: string,
  ): Promise<FlagConfigVersion> {
    const flags = await this.flagRepo.findByAccountAndService(
      accountId,
      serviceId,
    );
    const bundle = buildConfigBundle(flags, envName);
    const hash = hashConfigBundle(bundle);

    const latest = await this.versionRepo.getLatest(
      accountId,
      serviceId,
      envName,
    );
    if (latest && latest.hash === hash) {
      return latest;
    }

    const inserted = await this.versionRepo.insert({
      accountId,
      serviceId,
      environment: envName,
      version: (latest?.version ?? 0) + 1,
      hash,
      bundle,
    });

    if (this.serviceRepo) {
      try {
        const slug = await this.serviceRepo.ensureFlagPublishSlug(serviceId);
        await this.bundlePublisher.publish(slug, envName, bundle);
      } catch {
        // Best-effort, same contract as the version write itself: a missed
        // publish is recoverable — the SDK falls back to HTTP, and the next
        // flag write republishes current state anyway.
      }
    }

    return inserted;
  }

  async listVersions(
    accountId: ObjectId,
    serviceId: ObjectId,
    envName: string,
  ): Promise<FlagConfigVersion[]> {
    return this.versionRepo.list(accountId, serviceId, envName);
  }

  async getVersion(
    accountId: ObjectId,
    serviceId: ObjectId,
    envName: string,
    version: number,
  ): Promise<FlagConfigVersion | null> {
    return this.versionRepo.getByVersion(
      accountId,
      serviceId,
      envName,
      version,
    );
  }

  async getLatest(
    accountId: ObjectId,
    serviceId: ObjectId,
    envName: string,
  ): Promise<FlagConfigVersion | null> {
    return this.versionRepo.getLatest(accountId, serviceId, envName);
  }
}
