import { ObjectId } from "mongodb";
import { FlagRepository } from "../../repositories/flagRepository";
import {
  FlagConfigVersion,
  FlagConfigVersionRepository,
} from "../../repositories/flagConfigVersionRepository";
import { buildConfigBundle, hashConfigBundle } from "./configBundle";

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

    return this.versionRepo.insert({
      accountId,
      serviceId,
      environment: envName,
      version: (latest?.version ?? 0) + 1,
      hash,
      bundle,
    });
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
