import { PostHogClientLike } from "./posthogAnalytics";

export type PostHogOptions = {
  projectToken: string;
  host: string;
};

// Shape of the posthog-node module we construct from.
type PostHogSdk = {
  new (token: string, options: Record<string, unknown>): PostHogClientLike;
};
export type PostHogSdkLoader = () => { PostHog: PostHogSdk };

// eval("require") hides the specifier from the type-checker/bundler so an
// uninstalled posthog-node doesn't break the build; it throws at runtime only
// when PostHog is actually configured, and we degrade gracefully below. Same
// approach as the optional @sentry/node load in createErrorReporter.
const loadPostHogSdk: PostHogSdkLoader = () => {
  const optionalRequire = eval("require") as NodeRequire;
  return optionalRequire("posthog-node") as { PostHog: PostHogSdk };
};

/**
 * The only module that knows PostHog ships as an npm package.
 *
 * Everything downstream sees a `PostHogClientLike` — an interface we own — so
 * the vendor stays at the edge of the system and the analytics sink can be
 * tested without it.
 */
export function createPostHogClient(
  options: PostHogOptions | undefined,
  loadSdk: PostHogSdkLoader = loadPostHogSdk,
): PostHogClientLike | undefined {
  if (!options) return undefined;

  try {
    const { PostHog } = loadSdk();
    const client = new PostHog(options.projectToken, {
      host: options.host,
      // Covers exceptions that escape application and framework handlers.
      // Fastify's handled request failures remain on its existing onError path.
      enableExceptionAutocapture: true,
    });
    console.info(`[analytics] posthog enabled (host=${options.host})`);
    return client;
  } catch (err) {
    // Analytics is never worth a failed boot: log loudly and carry on with one
    // destination fewer.
    console.warn(
      "[analytics] PostHog is configured but the client could not be built; " +
        "product analytics will not reach PostHog. It ships as a dependency — " +
        "reinstall it (`yarn add posthog-node`) if this install was slimmed down.",
      err,
    );
    return undefined;
  }
}
