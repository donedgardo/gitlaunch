import { DeploymentStatus } from "../service/deploymentStatus";

/**
 * Why a build was sent to an environment.
 *
 * This is the one DORA input that cannot be inferred honestly from git. Tools
 * that sit outside the deploy path have to guess at rollbacks from revert
 * commits and hotfix branch names; because the promotion happens here, we can
 * record what actually occurred. Change failure rate and time to restore are
 * both derived from it, so a wrong guess corrupts two of the four keys —
 * hence the bias toward "promote" wherever the ordering is ambiguous.
 */
export type DeploymentIntent = "promote" | "rollback";

export type BuildRef = {
  buildId: string;
  createdAt: Date;
};

export type IntentInput = {
  /** The build being sent to the environment. */
  target: BuildRef;
  /** The build currently occupying the environment, or null if it is empty. */
  current: BuildRef | null;
};

export function deriveIntent({
  target,
  current,
}: IntentInput): DeploymentIntent {
  if (!current) {
    return "promote";
  }
  if (current.buildId === target.buildId) {
    return "promote";
  }
  return target.createdAt.getTime() < current.createdAt.getTime()
    ? "rollback"
    : "promote";
}

type IntentLog = {
  environment: string;
  status: DeploymentStatus;
  intent?: DeploymentIntent;
};

/**
 * The intent of the deployment currently in flight for an environment.
 *
 * Intent is decided once, when the build is dispatched, and the statuses that
 * follow inherit it. Time to restore is measured from the entry that says
 * service came back — so that entry has to know it was a rollback, not just
 * the dispatch that requested one.
 *
 * Returns undefined when the environment's latest deployment did not start
 * here (a reporter calling back about a deploy nobody dispatched through us).
 */
export function intentInFlight(
  logs: readonly IntentLog[],
  environment: string,
): DeploymentIntent | undefined {
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i];
    if (
      log.environment === environment &&
      log.status === DeploymentStatus.DISPATCHING
    ) {
      return log.intent;
    }
  }
  return undefined;
}
