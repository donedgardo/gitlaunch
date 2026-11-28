import { z } from "zod";
import { McpCaller, ToolRefused, defineTool } from "../tool";
import {
  AccountStanding,
  ServiceLookup,
  ServiceRecord,
  attributionOf,
  reasonInput,
  requireDeployPipeline,
  requireEnvironment,
  requireEnvironmentAccess,
  requireService,
  requireWritableAccount,
  serviceIdInput,
} from "./support";
import { Build } from "../../../repositories/buildRepository";
import { UpdateDeploymentStatusInput } from "../../build/buildService";
import { DeploymentStatus } from "../../service/deploymentStatus";

// BuildService satisfies this. It is the same call the REST deploy route and
// the dashboard's Deploy button make.
export type Deployer = {
  updateDeploymentStatus(input: UpdateDeploymentStatusInput): Promise<Build>;
};

export const WATCH_HINT =
  "Dispatched to the deploy pipeline; it has not landed yet. Call wait_for_deploy to wait for it and learn whether it ended deployed or error.";

/**
 * Starts a deploy of one build to one environment, after every check a deploy
 * has to pass. Shared by deploy_build and rollback_environment so that a
 * rollback can never be let through something a deploy would be refused for.
 */
export async function dispatchDeploy(
  deployer: Deployer,
  limits: AccountStanding,
  caller: McpCaller,
  service: ServiceRecord,
  buildId: string,
  environment: string,
  reason: string | undefined,
) {
  requireEnvironment(service, environment);
  requireEnvironmentAccess(caller, environment);
  requireDeployPipeline(service);
  await requireWritableAccount(limits, caller);

  let build: Build;
  try {
    build = await deployer.updateDeploymentStatus({
      accountId: caller.accountId,
      serviceId: service._id,
      buildId,
      environment,
      status: DeploymentStatus.DISPATCHING,
      ...attributionOf(caller, reason),
    });
  } catch (error) {
    // The one failure the caller can act on. Anything else may carry a CI
    // provider's response or a URL the customer chose, so it is left to be
    // reported as a fault.
    if (error instanceof Error && error.message === "Build not found") {
      throw new ToolRefused(
        `Build not found: ${buildId}. Call get_release_board for this service's build ids.`,
      );
    }
    throw error;
  }

  const entry = build.deploymentLogs[build.deploymentLogs.length - 1];
  return {
    buildId: build.buildId,
    environment,
    status: build.deployments[environment],
    ...(entry?.intent ? { intent: entry.intent } : {}),
    next: WATCH_HINT,
  };
}

export function deployBuildTool(
  services: ServiceLookup,
  deployer: Deployer,
  limits: AccountStanding,
) {
  return defineTool({
    name: "deploy_build",
    title: "Deploy a build",
    description:
      "Deploy one build of a service to one environment by triggering the service's own deploy pipeline. This changes what is running. It returns as soon as the deploy is dispatched, with status `dispatching`; it has not landed yet, so call get_release_board afterwards to see whether it reached `deployed` or `error`. `intent` says whether GitLaunch recorded this as a `promote` or, when the build is older than the one currently live, a `rollback`. Refused if the key's environment list does not include the environment. To undo a bad release, prefer rollback_environment, which picks the build for you.",
    requiredScope: "deployments:write",
    changes: true,
    input: {
      serviceId: serviceIdInput,
      buildId: z
        .string()
        .describe("The build to deploy, from get_release_board."),
      environment: z
        .string()
        .describe("The environment to deploy to, e.g. staging."),
      reason: reasonInput,
    },
    run: async (caller, input) => {
      const service = await requireService(services, caller, input.serviceId);
      return dispatchDeploy(
        deployer,
        limits,
        caller,
        service,
        input.buildId,
        input.environment,
        input.reason,
      );
    },
  });
}
