import { ObjectId } from "mongodb";
import { z } from "zod";
import { ToolRefused, defineTool } from "../tool";
import {
  AccountStanding,
  ServiceLookup,
  attributionOf,
  reasonInput,
  requireEnvironment,
  requireEnvironmentAccess,
  requireService,
  requireWritableAccount,
  serviceIdInput,
} from "./support";
import {
  Flag,
  FlagEnvironmentConfig,
} from "../../../repositories/flagRepository";
import { Attribution } from "../../service/actor";

// FlagService satisfies this. setEnvConfig is the same call the REST route and
// the flags page make.
export type FlagWriter = {
  getFlag(
    accountId: ObjectId,
    serviceId: ObjectId,
    key: string,
  ): Promise<Flag | null>;
  setEnvConfig(
    accountId: ObjectId,
    serviceId: ObjectId,
    key: string,
    environment: string,
    patch: { enabled?: boolean; rolloutPercentage?: number },
    by: Attribution,
  ): Promise<Flag>;
};

const switchOf = (config: FlagEnvironmentConfig | undefined) => ({
  enabled: config?.enabled ?? false,
  rolloutPercentage: config?.rolloutPercentage ?? 0,
});

export function setFlagEnvironmentTool(
  services: ServiceLookup,
  flags: FlagWriter,
  limits: AccountStanding,
) {
  return defineTool({
    name: "set_flag_environment",
    title: "Switch a feature flag",
    description:
      "Switch a feature flag on or off, or change how much traffic it is rolled out to, in one environment. This changes what users see, immediately, with no deploy. A flag reaches everyone only when `enabled` is true and `rolloutPercentage` is 100; enabled with a rollout of 0 reaches nobody. Pass only what you want to change; the rest is left as it is. Returns the flag's state in that environment before and after. To turn a feature off in a hurry, set `enabled` to false. Variants and targeting rules are not changed by this tool. Refused if the key's environment list does not include the environment.",
    requiredScope: "flags:write",
    changes: true,
    input: {
      serviceId: serviceIdInput,
      key: z.string().describe("The flag's key, from list_flags."),
      environment: z
        .string()
        .describe("The environment to change the flag in, e.g. prod."),
      enabled: z
        .boolean()
        .optional()
        .describe("Whether the flag is on in this environment."),
      rolloutPercentage: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional()
        .describe(
          "Share of traffic that gets the flag when it is on, 0 to 100.",
        ),
      reason: reasonInput,
    },
    run: async (caller, input) => {
      const service = await requireService(services, caller, input.serviceId);
      const { key, environment } = input;
      requireEnvironment(service, environment);
      requireEnvironmentAccess(caller, environment);

      if (
        input.enabled === undefined &&
        input.rolloutPercentage === undefined
      ) {
        throw new ToolRefused(
          "Nothing to change: pass enabled, rolloutPercentage, or both.",
        );
      }

      const flag = await flags.getFlag(caller.accountId, service._id, key);
      if (!flag) {
        throw new ToolRefused(
          `Flag not found: ${key}. Call list_flags for this service's flag keys.`,
        );
      }
      await requireWritableAccount(limits, caller);

      const before = switchOf(flag.environments[environment]);
      const updated = await flags.setEnvConfig(
        caller.accountId,
        service._id,
        key,
        environment,
        {
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.rolloutPercentage !== undefined
            ? { rolloutPercentage: input.rolloutPercentage }
            : {}),
        },
        attributionOf(caller, input.reason),
      );

      return {
        key,
        environment,
        before,
        after: switchOf(updated.environments[environment]),
      };
    },
  });
}
