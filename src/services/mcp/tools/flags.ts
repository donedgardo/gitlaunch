import { ObjectId } from "mongodb";
import { z } from "zod";
import { ToolRefused, defineTool } from "../tool";
import { ServiceLookup, requireService, serviceIdInput } from "./support";
import { Flag } from "../../../repositories/flagRepository";

// FlagService satisfies this.
export type FlagReader = {
  listFlags(accountId: ObjectId, serviceId: ObjectId): Promise<Flag[]>;
  getFlag(
    accountId: ObjectId,
    serviceId: ObjectId,
    key: string,
  ): Promise<Flag | null>;
};

export function listFlagsTool(services: ServiceLookup, flags: FlagReader) {
  return defineTool({
    name: "list_flags",
    title: "List feature flags",
    description:
      "List a service's feature flags with a summary of each flag in every environment: whether it is enabled, what percentage of traffic it is rolled out to, and how many variants and targeting rules it has. A flag is live for everyone in an environment only when it is enabled and rolled out to 100. Use get_flag for one flag's full variants and targeting rules.",
    requiredScope: "flags:read",
    changes: false,
    input: { serviceId: serviceIdInput },
    run: async (caller, input) => {
      const service = await requireService(services, caller, input.serviceId);
      const found = await flags.listFlags(caller.accountId, service._id);
      return {
        flags: found.map((flag) => ({
          key: flag.key,
          description: flag.description,
          environments: Object.fromEntries(
            Object.entries(flag.environments).map(([name, config]) => [
              name,
              {
                enabled: config.enabled,
                rolloutPercentage: config.rolloutPercentage,
                variants: config.variants.length,
                targetingRules: config.targetingRules?.length ?? 0,
              },
            ]),
          ),
        })),
      };
    },
  });
}

export function getFlagTool(services: ServiceLookup, flags: FlagReader) {
  return defineTool({
    name: "get_flag",
    title: "Get feature flag",
    description:
      "Get one feature flag's full configuration in every environment: enabled, rollout percentage, variants with their weights, and targeting rules. Targeting rules are evaluated before the rollout, first match wins.",
    requiredScope: "flags:read",
    changes: false,
    input: {
      serviceId: serviceIdInput,
      key: z.string().describe("The flag's key, from list_flags."),
    },
    run: async (caller, input) => {
      const service = await requireService(services, caller, input.serviceId);
      const flag = await flags.getFlag(
        caller.accountId,
        service._id,
        input.key,
      );
      if (!flag) {
        throw new ToolRefused(
          `Flag not found: ${input.key}. Call list_flags for this service's flag keys.`,
        );
      }
      return {
        key: flag.key,
        description: flag.description,
        environments: flag.environments,
        updatedAt: flag.updatedAt,
      };
    },
  });
}
