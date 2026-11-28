import { ToolCatalog } from "./toolCatalog";
import { ServiceDirectory, listServicesTool } from "./tools/listServices";
import { BuildHistory, ServiceLookup } from "./tools/support";
import { getReleaseBoardTool } from "./tools/getReleaseBoard";
import { waitForDeployTool } from "./tools/waitForDeploy";
import { getBuildTool } from "./tools/getBuild";
import { FlagHistory, getActivityTool } from "./tools/getActivity";
import {
  DeliveryMetrics,
  getDeliveryMetricsTool,
} from "./tools/getDeliveryMetrics";
import { FlagReader, getFlagTool, listFlagsTool } from "./tools/flags";
import { AccountStanding } from "./tools/support";
import { Deployer, deployBuildTool } from "./tools/deployBuild";
import { rollbackEnvironmentTool } from "./tools/rollbackEnvironment";
import { FlagWriter, setFlagEnvironmentTool } from "./tools/setFlagEnvironment";

// The version the MCP server reports to clients. Bump it when a tool's name
// or input changes in a way an existing agent would notice.
export const MCP_SERVER_VERSION = "0.2.0";

export type GitLaunchToolsDeps = {
  services: ServiceDirectory & ServiceLookup;
  builds: BuildHistory;
  flags: FlagReader & FlagWriter;
  metrics: DeliveryMetrics;
  deployer: Deployer;
  limits: AccountStanding;
  flagHistory: FlagHistory;
  // Injected so a metrics window is deterministic in tests.
  now?: () => Date;
};

/**
 * Every tool GitLaunch's MCP server offers, in the order a client lists them:
 * orient, look at releases, look at flags, then the three that change
 * something. This is the one place a tool is added.
 *
 * What is deliberately absent: nothing here deletes a flag, creates one, or
 * reconfigures a service or its environments. An agent can release and undo a
 * release; it cannot change what there is to release.
 */
export function gitlaunchTools(deps: GitLaunchToolsDeps): ToolCatalog {
  const { services, builds, flags, metrics, flagHistory, now } = deps;
  const { deployer, limits } = deps;
  return new ToolCatalog([
    listServicesTool(services),
    getReleaseBoardTool(services, builds),
    waitForDeployTool(services, builds),
    getBuildTool(services, builds),
    getActivityTool(services, builds, flagHistory),
    getDeliveryMetricsTool(services, metrics, now),
    listFlagsTool(services, flags),
    getFlagTool(services, flags),
    deployBuildTool(services, deployer, limits),
    rollbackEnvironmentTool(services, builds, deployer, limits),
    setFlagEnvironmentTool(services, flags, limits),
  ]);
}
