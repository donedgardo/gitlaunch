import { FastifyInstance } from "fastify";
import { buildPageMeta } from "../../seo/meta";

export type DocsRoutesDeps = {
  /** This instance's public origin — the examples are addressed to it. */
  publicUrl: string;
};

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
        meta,
      },
      { layout: "/layouts/main.hbs" },
    );
  });
}
