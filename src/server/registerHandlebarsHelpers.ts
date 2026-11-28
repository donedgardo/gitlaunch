import handlebars from "handlebars";
import { Build } from "../repositories/buildRepository";
import { DeploymentStatus } from "../services/service/deploymentStatus";
import { formatTimeAgo } from "./timeAgo";
import {
  buildSetupSnippets,
  SetupSnippets,
} from "../services/setup/setupSnippets";

// The snippets `setupSnippet` can render, by the name templates ask for.
// Adding a copy of CI/CD YAML to a template instead of a line here is how the
// GitHub Actions guides drifted from the generator and kept telling
// self-hosted customers to POST their builds — and their API key — to
// gitlaunch.dev.
const SETUP_SNIPPETS: Record<string, (s: SetupSnippets) => string> = {
  "buildReport.github": (s) => s.buildReport.github,
  "buildReport.gitlab": (s) => s.buildReport.gitlab,
  "deploy.github": (s) => s.deploy.github,
};

// Escapes a snippet for the one place it is ever rendered: element text inside
// `<pre><code>`. Only `&` and the angle brackets can be read as markup there,
// so quotes stay literal — the YAML is meant to be read, and Handlebars'
// default escaping would turn every `"` in it into `&quot;`. Never interpolate
// the result into an attribute.
function escapeSnippetText(snippet: string): handlebars.SafeString {
  return new handlebars.SafeString(
    snippet.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  );
}

// Templates hand environments over as the service's records, `{ name, order }`;
// the generator wants plain names in display order.
function environmentNames(environments: unknown): string[] {
  if (!Array.isArray(environments)) return [];
  return environments
    .map((environment) =>
      typeof environment === "string" ? environment : environment?.name,
    )
    .filter((name): name is string => typeof name === "string");
}

export function registerHandlebarsHelpers() {
  // Renders a CI/CD snippet from services/setup/setupSnippets.ts, the single
  // source of truth the /setup-snippets API also serves. A human copy-pasting
  // from the dashboard and an agent reading the API therefore get the same
  // YAML, addressed to the same host.
  //
  // `apiUrl` must be this instance's public URL. Absent, the snippet falls back
  // to a host-relative path: wrong for a copy-pasted workflow, but it can never
  // send somebody else's credential to a host we made up.
  handlebars.registerHelper(
    "setupSnippet",
    function (name: string, options: handlebars.HelperOptions) {
      const select = SETUP_SNIPPETS[name];
      if (!select) {
        throw new Error(`Unknown setup snippet: ${name}`);
      }
      const hash = options?.hash ?? {};
      return escapeSnippetText(
        select(
          buildSetupSnippets({
            apiUrl: hash.apiUrl ?? "",
            serviceId: hash.serviceId ?? "",
            defaultBranch: hash.defaultBranch ?? "",
            environments: environmentNames(hash.environments),
          }),
        ),
      );
    },
  );
  handlebars.registerHelper("eq", function (a, b) {
    return a === b;
  });
  handlebars.registerHelper(
    "getStatus",
    function (build: Build, environment: string) {
      return build.deployments[environment];
    },
  );
  // When this build last went live in an environment — rendered as "3d ago"
  // beside the Live pill. Undefined for builds deployed before we tracked it.
  handlebars.registerHelper(
    "getDeployedAt",
    function (build: Build, environment: string) {
      return build.deployedAt?.[environment];
    },
  );
  // Who shipped the build that is live in an environment — rendered as
  // "by Maria" after the live time. Absent when that is not known.
  handlebars.registerHelper(
    "getDeployedBy",
    function (
      build: { deployedBy?: Record<string, string | null> },
      environment: string,
    ) {
      return build.deployedBy?.[environment];
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
  // The "how long ago" label belongs to a currently-live environment only: an
  // in-progress or rolled-back cell would otherwise show a stale live time.
  handlebars.registerHelper(
    "showDeployedAt",
    function (status: DeploymentStatus, deployedAt: Date | string | null) {
      return status === DeploymentStatus.DEPLOYED && !!deployedAt;
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
