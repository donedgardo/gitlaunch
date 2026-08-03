// Where "Connect GitHub" sends someone. Shared by onboarding and settings,
// which had drifting copies of the same two-line rule.

export type GithubInstallConfig = {
  useFakes: boolean;
  appName?: string;
};

const DEFAULT_APP_NAME = "gitlaunchapp";

/**
 * In fake mode this hits our own callback directly, so it can carry a local
 * `returnTo` that survives the connect+select flow. The real GitHub App flow
 * cannot preserve it — GitHub owns the post-install redirect.
 */
export function githubInstallUrl(
  github: GithubInstallConfig,
  returnTo?: string,
): string {
  if (!github.useFakes) {
    const appName = github.appName || DEFAULT_APP_NAME;
    return `https://github.com/apps/${appName}/installations/new`;
  }

  const base = "/github/installation/callback?installation_id=12345";
  const isLocalPath =
    typeof returnTo === "string" &&
    returnTo.startsWith("/") &&
    !returnTo.startsWith("//");
  return isLocalPath
    ? `${base}&returnTo=${encodeURIComponent(returnTo)}`
    : base;
}
