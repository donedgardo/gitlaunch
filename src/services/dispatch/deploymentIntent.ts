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
