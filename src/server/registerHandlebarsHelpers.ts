import handlebars from "handlebars";
import { Build } from "../repositories/buildRepository";
import { DeploymentStatus } from "../services/service/deploymentStatus";

export function registerHandlebarsHelpers() {
  handlebars.registerHelper("eq", function (a, b) {
    return a === b;
  });
  handlebars.registerHelper(
    "getStatus",
    function (build: Build, environment: string) {
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
    function (githubFullName: string, buildId: string) {
      if (!githubFullName || !buildId) {
        return "#";
      }
      return `https://github.com/${githubFullName}/commit/${buildId}`;
    },
  );
  handlebars.registerHelper("shortSha", function (sha: string) {
    if (!sha) return "";
    return sha.substring(0, 7);
  });
  handlebars.registerHelper(
    "getStatusBadgeClass",
    function (status: DeploymentStatus) {
      const baseClass =
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium";
      switch (status) {
        case DeploymentStatus.DEPLOYED:
          return `${baseClass} bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100`;
        case DeploymentStatus.DEPLOYING:
          return `${baseClass} bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100 animate-pulse`;
        case DeploymentStatus.DISPATCHING:
          return `${baseClass} bg-yellow-100 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-100 animate-pulse`;
        case DeploymentStatus.ERROR:
          return `${baseClass} bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100`;
        case DeploymentStatus.CANCELLED:
          return `${baseClass} bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100`;
        default:
          return `${baseClass} bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100`;
      }
    },
  );
}
