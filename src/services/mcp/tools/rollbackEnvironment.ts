import { z } from "zod";
import { ToolRefused, defineTool } from "../tool";
import {
  AccountStanding,
  BuildHistory,
  ServiceLookup,
  reasonInput,
  requireEnvironment,
  requireService,
  serviceIdInput,
} from "./support";
import { Deployer, dispatchDeploy } from "./deployBuild";
import { Build } from "../../../repositories/buildRepository";
import { DeploymentStatus } from "../../service/deploymentStatus";

// When a build last went live in an environment, from its own history.
function lastLiveAt(build: Build, environment: string): number | null {
  let latest: number | null = null;
  for (const entry of build.deploymentLogs ?? []) {
    if (
      entry.environment === environment &&
      entry.status === DeploymentStatus.DEPLOYED
    ) {
      latest = Math.max(latest ?? 0, entry.at.getTime());
    }
  }
  return latest;
}

export function rollbackEnvironmentTool(
  services: ServiceLookup,
  builds: BuildHistory,
  deployer: Deployer,
  limits: AccountStanding,
) {
  return defineTool({
    name: "rollback_environment",
    title: "Roll back an environment",
    description:
      "Undo the latest release to an environment: redeploy the build that was live there immediately before the current one. This changes what is running. You do not choose the build; GitLaunch picks the one most recently live, which is not always the next oldest. Returns `rolledBackFrom` (what was live) and `buildId` (what is going back out), with status `dispatching`; call get_release_board to confirm it landed. Always give a `reason`: a rollback is the entry the team will most want explained. Refused if nothing is live there, if no earlier build was ever live there, or if the key's environment list does not include the environment.",
    requiredScope: "deployments:write",
    changes: true,
    input: {
      serviceId: serviceIdInput,
      environment: z
        .string()
        .describe("The environment to roll back, e.g. prod."),
      reason: reasonInput,
    },
    run: async (caller, input) => {
      const service = await requireService(services, caller, input.serviceId);
      const { environment } = input;
      requireEnvironment(service, environment);

      const all = await builds.getBuilds(caller.accountId, service._id);
      const current = all.find(
        (b) => b.deployments[environment] === DeploymentStatus.DEPLOYED,
      );
      if (!current) {
        throw new ToolRefused(
          `Nothing is live in ${environment}, so there is nothing to roll back. Use deploy_build to deploy a specific build.`,
        );
      }

      // The build most recently live before this one. Not "the next oldest
      // build": that one may never have reached this environment at all.
      const previous = all
        .filter((b) => b.buildId !== current.buildId)
        .map((b) => ({ build: b, liveAt: lastLiveAt(b, environment) }))
        .filter((candidate) => candidate.liveAt !== null)
        .sort((a, b) => b.liveAt! - a.liveAt!)[0]?.build;
      if (!previous) {
        throw new ToolRefused(
          `No earlier build has been live in ${environment}, so there is nothing to roll back to. ${current.buildId} is the only build that has been deployed there.`,
        );
      }

      const dispatched = await dispatchDeploy(
        deployer,
        limits,
        caller,
        service,
        previous.buildId,
        environment,
        input.reason,
      );
      return { rolledBackFrom: current.buildId, ...dispatched };
    },
  });
}
