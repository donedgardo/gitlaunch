import { FastifyInstance } from "fastify";
import { buildPageMeta } from "../../seo/meta";
import { ToolDescription } from "../../../services/mcp/toolCatalog";

export type DocsRoutesDeps = {
  /** This instance's public origin — the examples are addressed to it. */
  publicUrl: string;
  /**
   * The MCP server's tools, described by the catalog that serves them, so the
   * page cannot list a tool that does not exist or miss one that does. Absent
   * means this instance has no MCP server to document.
   */
  mcpTools?: readonly ToolDescription[];
};

// A tool's description is written for the model choosing it and runs to a
// paragraph. Its opening clause — up to the first full stop or colon — says
// what the tool does, which is all a table row needs.
function summaryOf(description: string): string {
  return description.split(/[.:](?:\s|$)/)[0];
}

// The integration contract, readable without an account.
//
// Registered outside the authenticated surface on purpose. Shared on a
// developer forum, a landing page whose only interactive element is an email
// field reads as an email harvester; the cure is letting a sceptic see exactly
// what the product does — the two HTTP calls, the snippets, the source — before
// they hand over anything.
export function registerDocsRoutes(
  app: FastifyInstance,
  deps: DocsRoutesDeps,
): void {
  const { publicUrl } = deps;
  const mcpTools = (deps.mcpTools ?? []).map((tool) => ({
    name: tool.name,
    summary: summaryOf(tool.description),
    scope: tool.requiredScope,
    changes: tool.changes,
  }));

  app.get("/docs", async (_request, reply) => {
    const meta = buildPageMeta({
      title: "How GitLaunch works — GitLaunch",
      description:
        "The whole integration in two HTTP calls: your CI reports a build, GitLaunch asks your CI to deploy it. Works on top of GitHub Actions, GitLab CI, Jenkins and CircleCI. Open core, self-hostable.",
      path: "/docs",
      publicUrl,
    });

    return reply.view(
      "docs/index.hbs",
      {
        title: "How GitLaunch works",
        publicUrl,
        sourceUrl: "https://github.com/donedgardo/gitlaunch",
        mcpTools,
        hasMcp: mcpTools.length > 0,
        meta,
      },
      { layout: "/layouts/main.hbs" },
    );
  });
}
