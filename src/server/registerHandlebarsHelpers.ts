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
  handlebars.registerHelper("canRedeploy", function (status: DeploymentStatus) {
    return (
      status === DeploymentStatus.DEPLOYED ||
      status === DeploymentStatus.ERROR ||
      status === DeploymentStatus.CANCELLED
    );
  });
  handlebars.registerHelper("canCancel", function (status: DeploymentStatus) {
    return (
      status === DeploymentStatus.DISPATCHING ||
      status === DeploymentStatus.DEPLOYING
    );
  });
  handlebars.registerHelper(
    "getBuildCommitLink",
    function (repoUrl: string, buildId: string) {
      if (!repoUrl || !buildId) {
        return "#";
      }
      return `${repoUrl.replace(/\/+$/, "")}/commit/${buildId}`;
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
  handlebars.registerHelper("add", function (a: number, b: number) {
    return a + b;
  });
  handlebars.registerHelper("subtract", function (a: number, b: number) {
    return a - b;
  });
  handlebars.registerHelper("lt", function (a: number, b: number) {
    return a < b;
  });
  handlebars.registerHelper("gt", function (a: number, b: number) {
    return a > b;
  });
  handlebars.registerHelper("times", function (n: number, options: any) {
    let result = "";
    for (let i = 1; i <= n; i++) {
      result += options.fn(i);
    }
    return result;
  });
}
