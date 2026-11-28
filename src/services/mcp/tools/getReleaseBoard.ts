import { z } from "zod";
import { defineTool } from "../tool";
import {
  BuildHistory,
  ServiceLookup,
  environmentNames,
  inFlightIn,
  liveIn,
  requireService,
  serviceIdInput,
  statusIn,
} from "./support";
import { describeActor, shippedBy } from "../../service/actor";

const DEFAULT_BUILDS = 20;
const MAX_BUILDS = 100;

export function getReleaseBoardTool(
  services: ServiceLookup,
  builds: BuildHistory,
) {
  return defineTool({
    name: "get_release_board",
    title: "Get release board",
    description:
      "See what is deployed where for one service. For each environment, in promotion order: the build that is live, when it went live and who shipped it, plus any deploy still in flight. Also lists recent builds, newest first, with each build's status in every environment. Use this before deploying, to pick a build id, and after deploying, to see whether it landed (status moves dispatching -> deploying -> deployed, or error).",
    requiredScope: "builds:read",
    changes: false,
    input: {
      serviceId: serviceIdInput,
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_BUILDS)
        .optional()
        .describe(
          `How many recent builds to list. Default ${DEFAULT_BUILDS}, at most ${MAX_BUILDS}.`,
        ),
    },
    run: async (caller, input) => {
      const service = await requireService(services, caller, input.serviceId);
      const all = await builds.getBuilds(caller.accountId, service._id);
      const environments = environmentNames(service);
      const limit = input.limit ?? DEFAULT_BUILDS;

      return {
        service: { id: service._id.toString(), name: service.name },
        // Read from the whole history, not the listed page: what is live is
        // often older than the newest few builds.
        environments: environments.map((name) => {
          const live = liveIn(all, name);
          const inFlight = inFlightIn(all, name);
          const who = live && shippedBy(live.deploymentLogs, name);
          return {
            name,
            live: live
              ? {
                  buildId: live.buildId,
                  ...(live.message ? { message: live.message } : {}),
                  deployedAt: live.deployedAt?.[name],
                  ...(who ? { deployedBy: describeActor(who) } : {}),
                }
              : null,
            inFlight: inFlight
              ? { buildId: inFlight.buildId, status: statusIn(inFlight, name) }
              : null,
          };
        }),
        builds: all.slice(0, limit).map((b) => ({
          buildId: b.buildId,
          ...(b.message ? { message: b.message } : {}),
          reportedAt: b.createdAt,
          deployments: Object.fromEntries(
            environments.map((name) => [name, statusIn(b, name)]),
          ),
        })),
        moreBuilds: all.length > limit,
      };
    },
  });
}
