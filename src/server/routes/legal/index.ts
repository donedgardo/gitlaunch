import { FastifyInstance } from "fastify";
import { buildPageMeta } from "../../seo/meta";

// The date the current wording of both documents took effect. Bump this in the
// same commit that changes the wording — a policy whose text and stated
// effective date disagree is worse than no date at all, because it misrepresents
// which version a customer accepted.
//
// Both documents share one date deliberately: they are revised together, and a
// single date is one fewer thing to get out of sync.
export const LEGAL_EFFECTIVE_DATE = "July 26, 2026";

type LegalPage = {
  path: string;
  template: string;
  title: string;
  description: string;
};

const PAGES: LegalPage[] = [
  {
    path: "/privacy",
    template: "legal/privacy.hbs",
    title: "Privacy Policy",
    description:
      "How GitLaunch collects, uses, and protects your data — including what we deliberately never collect.",
  },
  {
    path: "/terms",
    template: "legal/terms.hbs",
    title: "Terms of Service",
    description:
      "The terms that govern your use of GitLaunch, including beta access, billing, and liability.",
  },
];

export type LegalRoutesDeps = {
  publicUrl: string;
};

export function registerLegalRoutes(
  app: FastifyInstance,
  deps: LegalRoutesDeps,
): void {
  const { publicUrl } = deps;
  for (const page of PAGES) {
    // Registered outside the authenticated surface on purpose. Terms a visitor
    // has to log in to read cannot bind them at the moment they sign up, and
    // the review bots at GitHub, Stripe and Google fetch these URLs with no
    // session at all.
    app.get(page.path, async (_request, reply) => {
      const meta = buildPageMeta({
        title: `${page.title} — GitLaunch`,
        description: page.description,
        path: page.path,
        publicUrl,
      });

      return reply.view(
        page.template,
        {
          title: page.title,
          lastUpdated: LEGAL_EFFECTIVE_DATE,
          meta,
        },
        { layout: "/layouts/main.hbs" },
      );
    });
  }
}
