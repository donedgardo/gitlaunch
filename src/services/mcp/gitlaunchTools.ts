import { ToolCatalog } from "./toolCatalog";
import { ServiceDirectory, listServicesTool } from "./tools/listServices";

// The version the MCP server reports to clients. Bump it when a tool's name
// or input changes in a way an existing agent would notice.
export const MCP_SERVER_VERSION = "0.1.0";

export type GitLaunchToolsDeps = {
  services: ServiceDirectory;
};

/**
 * Every tool GitLaunch's MCP server offers, in the order a client lists them.
 * This is the one place a tool is added.
 */
export function gitlaunchTools(deps: GitLaunchToolsDeps): ToolCatalog {
  return new ToolCatalog([listServicesTool(deps.services)]);
}
