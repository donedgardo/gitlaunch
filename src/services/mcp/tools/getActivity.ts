import { ObjectId } from "mongodb";
import { z } from "zod";
import { defineTool } from "../tool";
import {
  BuildHistory,
  ServiceLookup,
  requireEnvironment,
  requireService,
  serviceIdInput,
  whoOf,
} from "./support";
import { FlagChange } from "../../../repositories/flagChangeRepository";
import { DeploymentStatus } from "../../service/deploymentStatus";

// FlagChangeRepository satisfies this. Changes come back newest first.
export type FlagHistory = {
  listByService(
    accountId: ObjectId,
    serviceId: ObjectId,
    limit?: number,
  ): Promise<FlagChange[]>;
};

const DEFAULT_EVENTS = 30;
const MAX_EVENTS = 200;

type Event = { at: Date } & Record<string, unknown>;

export function getActivityTool(
  services: ServiceLookup,
  builds: BuildHistory,
  flagHistory: FlagHistory,
) {
  return defineTool({
    name: "get_activity",
    title: "Get recent activity",
    description:
      "Get one timeline of what recently changed for a service, newest first: deployment status changes and feature flag changes, each with who made it (a person or an API key), how (dashboard, api or mcp) and the reason if one was given. Flag changes carry the configuration before and after. This is the first thing to read when something has just gone wrong: it answers 'what changed, and who changed it?'. Flag changes are included only when the key can also read flags; `flagChangesIncluded` says whether they were.",
    requiredScope: "builds:read",
    changes: false,
    input: {
      serviceId: serviceIdInput,
      environment: z
        .string()
        .optional()
        .describe(
          "Only show changes to this environment. Creating or deleting a flag affects every environment, so those are always shown.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_EVENTS)
        .optional()
        .describe(
          `How many events to return. Default ${DEFAULT_EVENTS}, at most ${MAX_EVENTS}.`,
        ),
    },
    run: async (caller, input) => {
      const service = await requireService(services, caller, input.serviceId);
      if (input.environment) requireEnvironment(service, input.environment);
      const inScope = (environment?: string) =>
        !input.environment || !environment || environment === input.environment;

      const events: Event[] = [];

      const all = await builds.getBuilds(caller.accountId, service._id);
      for (const build of all) {
        for (const entry of build.deploymentLogs ?? []) {
          // "none" is the system noting a build was superseded when another
          // went live. Nobody did it, and the deploy that caused it is already
          // in the timeline.
          if (entry.status === DeploymentStatus.NONE) continue;
          // Entries written before the log was dated cannot be placed on a
          // timeline, so they are left out rather than guessed at.
          if (!entry.at) continue;
          if (!inScope(entry.environment)) continue;
          events.push({
            at: entry.at,
            kind: "deploy",
            buildId: build.buildId,
            environment: entry.environment,
            status: entry.status,
            ...(entry.intent ? { intent: entry.intent } : {}),
            ...whoOf(entry.actor),
            ...(entry.reason ? { reason: entry.reason } : {}),
          });
        }
      }

      // A key that cannot read flags is not shown flag history through the
      // back door of a tool it can use.
      const flagChangesIncluded = caller.scopes.includes("flags:read");
      if (flagChangesIncluded) {
        const changes = await flagHistory.listByService(
          caller.accountId,
          service._id,
          MAX_EVENTS,
        );
        for (const change of changes) {
          if (!inScope(change.environment)) continue;
          events.push({
            at: change.at,
            kind: "flag",
            flagKey: change.flagKey,
            change: change.change,
            ...(change.environment ? { environment: change.environment } : {}),
            ...(change.before ? { before: change.before } : {}),
            ...(change.after ? { after: change.after } : {}),
            ...whoOf(change.actor),
            ...(change.reason ? { reason: change.reason } : {}),
          });
        }
      }

      events.sort((a, b) => b.at.getTime() - a.at.getTime());
      return {
        events: events.slice(0, input.limit ?? DEFAULT_EVENTS),
        flagChangesIncluded,
      };
    },
  });
}
