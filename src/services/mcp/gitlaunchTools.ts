import { ToolCatalog } from "./toolCatalog";
import { ServiceDirectory, listServicesTool } from "./tools/listServices";
import { BuildHistory, ServiceLookup } from "./tools/support";
import { getReleaseBoardTool } from "./tools/getReleaseBoard";
import { getBuildTool } from "./tools/getBuild";
import { FlagHistory, getActivityTool } from "./tools/getActivity";
import {
  DeliveryMetrics,
  getDeliveryMetricsTool,
} from "./tools/getDeliveryMetrics";
import { FlagReader, getFlagTool, listFlagsTool } from "./tools/flags";

// The version the MCP server reports to clients. Bump it when a tool's name
// or input changes in a way an existing agent would notice.
export const MCP_SERVER_VERSION = "0.1.0";

export type GitLaunchToolsDeps = {
  services: ServiceDirectory & ServiceLookup;
  builds: BuildHistory;
  flags: FlagReader;
  metrics: DeliveryMetrics;
  flagHistory: FlagHistory;
  // Injected so a metrics window is deterministic in tests.
  now?: () => Date;
};

/**
 * Every tool GitLaunch's MCP server offers, in the order a client lists them:
 * orient, look at releases, look at flags. This is the one place a tool is
 * added.
 */
export function gitlaunchTools(deps: GitLaunchToolsDeps): ToolCatalog {
  const { services, builds, flags, metrics, flagHistory, now } = deps;
  return new ToolCatalog([
    listServicesTool(services),
    getReleaseBoardTool(services, builds),
    getBuildTool(services, builds),
    getActivityTool(services, builds, flagHistory),
    getDeliveryMetricsTool(services, metrics, now),
    listFlagsTool(services, flags),
    getFlagTool(services, flags),
  ]);
}
