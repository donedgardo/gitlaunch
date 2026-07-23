import { ObjectId } from "mongodb";
import {
  FlagRepository,
  Flag,
  FlagVariant,
  FlagEnvironmentConfig,
  defaultEnvironmentConfig,
} from "../../repositories/flagRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { FlagCacheI, InMemoryFlagCache } from "./flagCache";
import { evaluateFlag, FlagEvaluation } from "./flagEvaluator";

const FLAG_KEY_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type CreateFlagInput = {
  key: string;
  description: string;
};

export type EnvConfigPatch = Partial<FlagEnvironmentConfig>;

export interface FlagServiceI {
  createFlag(
    accountId: ObjectId,
    serviceId: ObjectId,
    input: CreateFlagInput,
  ): Promise<Flag>;
  listFlags(accountId: ObjectId, serviceId: ObjectId): Promise<Flag[]>;
  getFlag(
    accountId: ObjectId,
    serviceId: ObjectId,
    key: string,
  ): Promise<Flag | null>;
  setEnvConfig(
    accountId: ObjectId,
    serviceId: ObjectId,
    key: string,
    envName: string,
    patch: EnvConfigPatch,
  ): Promise<Flag>;
  deleteFlag(
    accountId: ObjectId,
    serviceId: ObjectId,
    key: string,
  ): Promise<boolean>;
  evaluate(
    accountId: ObjectId,
    serviceId: ObjectId,
    envName: string,
    entityKey: string,
  ): Promise<FlagEvaluation[]>;
  evaluateOne(
    accountId: ObjectId,
    serviceId: ObjectId,
    envName: string,
    key: string,
    entityKey: string,
  ): Promise<FlagEvaluation | null>;
}

export class FlagService implements FlagServiceI {
  constructor(
    private flagRepo: FlagRepository,
    private serviceRepo: ServiceRepository,
    private cache: FlagCacheI = new InMemoryFlagCache(),
  ) {}

  private cacheKey(accountId: ObjectId, serviceId: ObjectId): string {
    return `${accountId.toString()}:${serviceId.toString()}`;
  }

  async createFlag(
    accountId: ObjectId,
    serviceId: ObjectId,
    input: CreateFlagInput,
  ): Promise<Flag> {
    if (!FLAG_KEY_REGEX.test(input.key)) {
      throw new Error("Flag key must be lowercase alphanumeric with hyphens");
    }

    const service = await this.getServiceOrThrow(accountId, serviceId);

    const existing = await this.flagRepo.findByKey(
      accountId,
      serviceId,
      input.key,
    );
    if (existing) {
      throw new Error("Flag key already exists");
    }

    // Seed every current environment as off so the flag is safe by default.
    const environments: Record<string, FlagEnvironmentConfig> = {};
    for (const env of service.environments) {
      environments[env.name] = defaultEnvironmentConfig();
    }

    const flag = await this.flagRepo.create({
      accountId,
      serviceId,
      key: input.key,
      description: input.description ?? "",
      environments,
    });
    await this.cache.invalidate(this.cacheKey(accountId, serviceId));
    return flag;
  }

  async listFlags(accountId: ObjectId, serviceId: ObjectId): Promise<Flag[]> {
    return this.flagRepo.findByAccountAndService(accountId, serviceId);
  }

  async getFlag(
    accountId: ObjectId,
    serviceId: ObjectId,
    key: string,
  ): Promise<Flag | null> {
    return this.flagRepo.findByKey(accountId, serviceId, key);
  }

  async setEnvConfig(
    accountId: ObjectId,
    serviceId: ObjectId,
    key: string,
    envName: string,
    patch: EnvConfigPatch,
  ): Promise<Flag> {
    const service = await this.getServiceOrThrow(accountId, serviceId);
    if (!service.environments.some((e) => e.name === envName)) {
      throw new Error("Environment not found");
    }

    const flag = await this.flagRepo.findByKey(accountId, serviceId, key);
    if (!flag) {
      throw new Error("Flag not found");
    }

    const current = flag.environments[envName] ?? defaultEnvironmentConfig();
    const next: FlagEnvironmentConfig = {
      enabled: patch.enabled ?? current.enabled,
      rolloutPercentage: patch.rolloutPercentage ?? current.rolloutPercentage,
      variants: patch.variants ?? current.variants,
    };

    this.validateEnvConfig(next);

    const updated = await this.flagRepo.updateEnvConfig(
      accountId,
      serviceId,
      key,
      envName,
      next,
    );
    if (!updated) {
      throw new Error("Failed to update flag");
    }
    await this.cache.invalidate(this.cacheKey(accountId, serviceId));
    return updated;
  }

  async deleteFlag(
    accountId: ObjectId,
    serviceId: ObjectId,
    key: string,
  ): Promise<boolean> {
    const deleted = await this.flagRepo.delete(accountId, serviceId, key);
    await this.cache.invalidate(this.cacheKey(accountId, serviceId));
    return deleted;
  }

  async evaluate(
    accountId: ObjectId,
    serviceId: ObjectId,
    envName: string,
    entityKey: string,
  ): Promise<FlagEvaluation[]> {
    const flags = await this.getServiceFlagsCached(accountId, serviceId);
    return flags.map((flag) => {
      const cfg = flag.environments[envName] ?? defaultEnvironmentConfig();
      return evaluateFlag(cfg, flag.key, entityKey);
    });
  }

  // Deterministic single-flag evaluation. Used to attribute an entity to the
  // variant it was (and will always be) assigned, e.g. when recording an
  // experiment conversion. Returns null when the flag doesn't exist.
  async evaluateOne(
    accountId: ObjectId,
    serviceId: ObjectId,
    envName: string,
    key: string,
    entityKey: string,
  ): Promise<FlagEvaluation | null> {
    const flags = await this.getServiceFlagsCached(accountId, serviceId);
    const flag = flags.find((f) => f.key === key);
    if (!flag) {
      return null;
    }
    const cfg = flag.environments[envName] ?? defaultEnvironmentConfig();
    return evaluateFlag(cfg, flag.key, entityKey);
  }

  // Read-through cache: evaluation avoids Mongo on a hit. Writes invalidate.
  private async getServiceFlagsCached(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<Flag[]> {
    const key = this.cacheKey(accountId, serviceId);
    const cached = await this.cache.get(key);
    if (cached) {
      return cached;
    }
    const flags = await this.flagRepo.findByAccountAndService(
      accountId,
      serviceId,
    );
    await this.cache.set(key, flags);
    return flags;
  }

  private validateEnvConfig(cfg: FlagEnvironmentConfig): void {
    if (
      !Number.isFinite(cfg.rolloutPercentage) ||
      cfg.rolloutPercentage < 0 ||
      cfg.rolloutPercentage > 100
    ) {
      throw new Error("Rollout percentage must be between 0 and 100");
    }

    if (cfg.variants.length > 0) {
      this.validateVariants(cfg.variants);
    }
  }

  private validateVariants(variants: FlagVariant[]): void {
    const keys = new Set<string>();
    let total = 0;
    for (const variant of variants) {
      if (!FLAG_KEY_REGEX.test(variant.key)) {
        throw new Error(
          "Variant key must be lowercase alphanumeric with hyphens",
        );
      }
      if (keys.has(variant.key)) {
        throw new Error("Variant keys must be unique");
      }
      keys.add(variant.key);
      if (
        !Number.isInteger(variant.weight) ||
        variant.weight < 0 ||
        variant.weight > 100
      ) {
        throw new Error("Variant weight must be an integer between 0 and 100");
      }
      total += variant.weight;
    }
    if (total !== 100) {
      throw new Error("Variant weights must sum to 100");
    }
  }

  private async getServiceOrThrow(accountId: ObjectId, serviceId: ObjectId) {
    const service = await this.serviceRepo.findByAccountAndId(
      accountId,
      serviceId,
    );
    if (!service) {
      throw new Error("Service not found");
    }
    return service;
  }
}
