// Builds the SEO / social-sharing metadata for a full HTML page: the tags that
// let search engines index us and let Slack, X/Twitter, iMessage, LinkedIn, etc.
// render a rich preview card instead of a bare URL.
//
// This is a pure function on purpose — it takes what a page knows about itself
// plus the site's public origin, and returns a fully-resolved bag of values the
// layout renders verbatim. No `process.env` reads and no I/O, so it is trivial
// to test and a route can override any field.

const SITE_NAME = "GitLaunch";

// The site-wide fallbacks, used for any page that does not describe itself.
const DEFAULT_TITLE = "GitLaunch — Know exactly what's deployed where";
const DEFAULT_DESCRIPTION =
  "GitLaunch shows every build across every environment and gives your whole team a safe button to ship and roll back. Deployment control, not another CI/CD tool.";
// A pre-rendered 1200×630 branded card, served from /public. Regenerate with
// scripts/generate-og-image.mjs.
const DEFAULT_IMAGE = "/public/og-image.png";

export type PageMetaOptions = {
  // Page-specific title. Doubles as og:title / twitter:title.
  title?: string;
  // Page-specific description. Doubles as the meta description and og/twitter.
  description?: string;
  // The page's own path (e.g. "/invite/abc"), turned into an absolute canonical
  // and og:url against `publicUrl`. Defaults to the site root.
  path?: string;
  // Social image — a relative path resolved against `publicUrl`, or an already
  // absolute URL used as-is. Defaults to the shared branded card.
  image?: string;
  // og:type — "website" for most pages, "article" for content, etc.
  type?: string;
  // robots directive. Defaults to indexable; pass "noindex, nofollow" for pages
  // behind a secret token (invite links) so they unfurl but never get indexed.
  robots?: string;
  // The site's public origin (PUBLIC_URL). Injected rather than read from env so
  // the builder stays pure and testable.
  publicUrl?: string;
};

export type PageMeta = {
  description: string;
  canonical: string;
  robots: string;
  ogTitle: string;
  ogDescription: string;
  ogType: string;
  ogUrl: string;
  ogImage: string;
  ogSiteName: string;
  twitterCard: string;
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string;
};

// Joins an origin and a path into one clean absolute URL. If there is no origin
// (PUBLIC_URL unset in local dev), we degrade to the path rather than emitting a
// broken "undefined/..." url.
function toAbsolute(publicUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const origin = publicUrl.replace(/\/+$/, "");
  if (!origin) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${origin}${path}`;
}

export function buildPageMeta(options: PageMetaOptions = {}): PageMeta {
  const publicUrl = options.publicUrl ?? "";
  const path = options.path ?? "/";

  const title = options.title || DEFAULT_TITLE;
  const description = options.description || DEFAULT_DESCRIPTION;
  const type = options.type || "website";
  const url = toAbsolute(publicUrl, path);
  const image = toAbsolute(publicUrl, options.image || DEFAULT_IMAGE);

  return {
    description,
    canonical: url,
    robots: options.robots || "index, follow",
    ogTitle: title,
    ogDescription: description,
    ogType: type,
    ogUrl: url,
    ogImage: image,
    ogSiteName: SITE_NAME,
    // "summary_large_image" gives the big edge-to-edge card rather than a thumbnail.
    twitterCard: "summary_large_image",
    twitterTitle: title,
    twitterDescription: description,
    twitterImage: image,
  };
}
