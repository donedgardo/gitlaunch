// Which environment this instance is running as ("prod", "staging", ...).
//
// One label, shared by everything that reports on or scopes by environment —
// error reporting and the self-flag scope today. It is deliberately not tied to
// any one feature: NODE_ENV only distinguishes production from not (and the
// Helm chart pins it to "production"), so it cannot tell a staging install from
// a production one on its own.
//
// GITLAUNCH_FLAG_ENV is the original name, from when the flag scope was the
// only thing that needed this. It still works so existing deploys keep their
// label; GITLAUNCH_ENV is the name to use going forward.
export function resolveEnvironmentName(
  env: NodeJS.ProcessEnv = process.env,
  fallback = "development",
): string {
  const configured = [
    env.GITLAUNCH_ENV,
    env.GITLAUNCH_FLAG_ENV,
    env.NODE_ENV,
  ].find((value) => value?.trim());

  return configured?.trim() ?? fallback;
}
