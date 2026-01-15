import handlebars from "handlebars";
import { BuildRecord } from "../services/buildStorage/buildRecord";
import { DeploymentStatus } from "../services/service/deploymentStatus";

export function registerHandlebarsHelpers() {
  handlebars.registerHelper("eq", function (a, b) {
    return a === b;
  });
  handlebars.registerHelper(
    "getStatus",
    function (build: BuildRecord, environment: string) {
      return build.deployments[environment];
    },
  );
  handlebars.registerHelper(
    "showDeployButton",
    function (status: DeploymentStatus) {
      return !status || status === DeploymentStatus.NONE;
    },
  );
  handlebars.registerHelper(
    "getBuildCommitLink",
    function (serviceName: string, buildId: string) {
      const githubOrg = process.env.GITHUB_ORG;
      return `https://github.com/${githubOrg}/${serviceName}/commit/${buildId}`;
    },
  );
}
