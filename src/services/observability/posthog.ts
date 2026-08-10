import { PostHog } from "posthog-node";

const projectToken = process.env.POSTHOG_PROJECT_TOKEN?.trim();
const host = process.env.POSTHOG_HOST?.trim();

function requirePostHogEnvironmentVariable(name: string): void {
  if (process.env.NODE_ENV !== "production") {
    throw new Error(
      `${name} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${name} is configured`,
    );
  }
}

if (!projectToken) requirePostHogEnvironmentVariable("POSTHOG_PROJECT_TOKEN");
if (!host) requirePostHogEnvironmentVariable("POSTHOG_HOST");

// The server is long-lived, so every request shares this client. Route handlers
// should import it from this module and flush after capturing request events.
export const posthog =
  projectToken && host
    ? new PostHog(projectToken, {
        host,
        enableExceptionAutocapture: true,
      })
    : undefined;
