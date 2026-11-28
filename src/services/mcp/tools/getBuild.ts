import { z } from "zod";
import { ToolRefused, defineTool } from "../tool";
import {
  BuildHistory,
  ServiceLookup,
  environmentNames,
  requireService,
  serviceIdInput,
  whoOf,
} from "./support";
import { DeploymentStatus } from "../../service/deploymentStatus";

export function getBuildTool(services: ServiceLookup, builds: BuildHistory) {
  return defineTool({
    name: "get_build",
    title: "Get build",
    description:
      "Get one build and its full deployment history: every status change in every environment, oldest first, with who made it (a person, or an API key), how (dashboard, api or mcp), whether it was a promote or a rollback, and the reason if one was given. Use this to find out why and by whom a build was deployed or rolled back.",
    requiredScope: "builds:read",
    changes: false,
    input: {
      serviceId: serviceIdInput,
      buildId: z.string().describe("The build's id, from get_release_board."),
    },
    run: async (caller, input) => {
      const service = await requireService(services, caller, input.serviceId);
      const all = await builds.getBuilds(caller.accountId, service._id);
      const build = all.find((b) => b.buildId === input.buildId);
      if (!build) {
        throw new ToolRefused(
          `Build not found: ${input.buildId}. Call get_release_board for this service's build ids.`,
        );
      }

      return {
        buildId: build.buildId,
        ...(build.message ? { message: build.message } : {}),
        reportedAt: build.createdAt,
        ...(build.commitAt ? { commitAt: build.commitAt } : {}),
        deployments: Object.fromEntries(
          environmentNames(service).map((name) => [
            name,
            build.deployments[name] ?? DeploymentStatus.NONE,
          ]),
        ),
        history: (build.deploymentLogs ?? []).map((entry) => ({
          at: entry.at,
          environment: entry.environment,
          status: entry.status,
          ...(entry.intent ? { intent: entry.intent } : {}),
          ...whoOf(entry.actor),
          ...(entry.reason ? { reason: entry.reason } : {}),
        })),
      };
    },
  });
}
