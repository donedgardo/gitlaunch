import { z } from "zod";
import { defineTool } from "../tool";
import {
  BuildHistory,
  ServiceLookup,
  inFlightIn,
  liveIn,
  requireEnvironment,
  requireService,
  serviceIdInput,
  statusIn,
} from "./support";

const DEFAULT_TIMEOUT_SECONDS = 30;
// Under a minute on purpose: the wait holds one request open, and clients and
// proxies commonly give up on a request at sixty seconds.
const MAX_TIMEOUT_SECONDS = 50;
const POLL_MS = 1000;

export type Pause = (ms: number) => Promise<void>;

const realPause: Pause = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waiting, as a tool. An agent has no good way to wait on its own: it either
 * reads the board in a tight loop or sleeps for a guess. This holds the call
 * open until the pipeline reports back, so the next thing the agent does is
 * act on the outcome.
 */
export function waitForDeployTool(
  services: ServiceLookup,
  builds: BuildHistory,
  pause: Pause = realPause,
) {
  return defineTool({
    name: "wait_for_deploy",
    title: "Wait for a deploy to finish",
    description:
      "Wait for the deploy in flight in one environment to finish, then say how it ended. Call this straight after deploy_build or rollback_environment instead of polling get_release_board or sleeping. Returns `settled: true` with `outcome` (the build and whether it ended deployed or error) and the build now live; returns at once, with `outcome: null`, when nothing is in flight. If the deploy is still running after the time allowed it returns `settled: false`: call it again to keep waiting.",
    requiredScope: "builds:read",
    changes: false,
    input: {
      serviceId: serviceIdInput,
      environment: z.string().describe("The environment to watch."),
      timeoutSeconds: z
        .number()
        .int()
        .min(1)
        .max(MAX_TIMEOUT_SECONDS)
        .optional()
        .describe(
          `How long to wait before giving up. Default ${DEFAULT_TIMEOUT_SECONDS}, at most ${MAX_TIMEOUT_SECONDS}.`,
        ),
    },
    run: async (caller, input) => {
      const service = await requireService(services, caller, input.serviceId);
      requireEnvironment(service, input.environment);
      const environment = input.environment;
      const timeout = input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;

      // The build we saw in flight, so we can say how it ended once the
      // environment goes quiet.
      let watching: string | null = null;
      for (let waited = 0; ; waited += 1) {
        const all = await builds.getBuilds(caller.accountId, service._id);
        const inFlight = inFlightIn(all, environment);

        if (!inFlight) {
          const watched = all.find((b) => b.buildId === watching);
          const live = liveIn(all, environment);
          return {
            environment,
            settled: true,
            waitedSeconds: waited,
            outcome: watched
              ? {
                  buildId: watched.buildId,
                  status: statusIn(watched, environment),
                }
              : null,
            live: live
              ? {
                  buildId: live.buildId,
                  ...(live.message ? { message: live.message } : {}),
                }
              : null,
          };
        }

        watching = inFlight.buildId;
        if (waited >= timeout) {
          return {
            environment,
            settled: false,
            waitedSeconds: waited,
            inFlight: {
              buildId: inFlight.buildId,
              status: statusIn(inFlight, environment),
            },
            next: `Still in flight after ${waited} seconds. Call wait_for_deploy again to keep waiting.`,
          };
        }
        await pause(POLL_MS);
      }
    },
  });
}
