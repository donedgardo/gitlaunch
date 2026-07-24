import handlebars from "handlebars";
import { Build } from "../repositories/buildRepository";
import { DeploymentStatus } from "../services/service/deploymentStatus";
import { formatTimeAgo } from "./timeAgo";

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
  // Renders a build's report time as a compact "how long ago" label
  // (e.g. "18m ago"). Snapshot at render time; a page load refreshes it.
  handlebars.registerHelper(
    "timeAgo",
    function (date: Date | string | null | undefined) {
      return formatTimeAgo(date, new Date());
    },
  );
  // Maps a deployment status to a release-board status pill (styles live in
  // src/styles/input.css under `.gl-board .pill-*`). Live and in-motion states
  // pair with a pulsing dot — see the `showStatusDot` helper below.
  handlebars.registerHelper(
    "getStatusBadgeClass",
    function (status: DeploymentStatus) {
      const base = "pill";
      switch (status) {
        case DeploymentStatus.DEPLOYED:
          return `${base} pill-live`;
        case DeploymentStatus.DEPLOYING:
          return `${base} pill-progress`;
        case DeploymentStatus.DISPATCHING:
          return `${base} pill-pending`;
        case DeploymentStatus.ERROR:
          return `${base} pill-error`;
        case DeploymentStatus.CANCELLED:
          return `${base} pill-idle`;
        default:
          return `${base} pill-idle`;
      }
    },
  );
  // A live/in-motion deployment gets a pulsing dot in its pill; settled states
  // (error, cancelled) do not.
  handlebars.registerHelper(
    "showStatusDot",
    function (status: DeploymentStatus) {
      return (
        status === DeploymentStatus.DEPLOYED ||
        status === DeploymentStatus.DEPLOYING ||
        status === DeploymentStatus.DISPATCHING
      );
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
