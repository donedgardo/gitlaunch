import { DeploymentStatus } from "../service/deploymentStatus";
import { DeploymentAttempt } from "./deploymentHistory";
import { formatDuration } from "./fourKeysView";

/**
 * One line of deployment history, formatted for a screen.
 *
 * Kept apart from `toDeploymentAttempts` for the same reason the four keys
 * are: that one argues about what counts as a deployment, this one argues
 * about what a person can read. Both are pure, so neither needs a route to
 * be tested.
 */
export type DeploymentHistoryEntry = {
  buildId: string;
  environment: string;
  /** "Deployed", "Failed", "Cancelled", … — no status enum on the page. */
  statusLabel: string;
  /** When to date the row: when it settled, or when it began if it has not. */
  at: Date;
  /** e.g. "6m", or "—" when we cannot say how long it took. */
  duration: string;
  /** A deploy that undid a previous one — the line worth spotting. */
  isRollback: boolean;
  /** Ended badly: styling, and the reason the row is worth reading. */
  failed: boolean;
  /** Still running right now. */
  inFlight: boolean;
};

const STATUS_LABELS: Record<DeploymentStatus, string> = {
  [DeploymentStatus.DEPLOYED]: "Deployed",
  [DeploymentStatus.ERROR]: "Failed",
  [DeploymentStatus.CANCELLED]: "Cancelled",
  [DeploymentStatus.DEPLOYING]: "Deploying",
  [DeploymentStatus.DISPATCHING]: "Dispatching",
  [DeploymentStatus.NONE]: "Unknown",
};

const IN_FLIGHT = new Set<DeploymentStatus>([
  DeploymentStatus.DISPATCHING,
  DeploymentStatus.DEPLOYING,
]);

export function toDeploymentHistoryView(
  attempts: readonly DeploymentAttempt[],
): DeploymentHistoryEntry[] {
  return attempts.map((attempt) => ({
    buildId: attempt.buildId,
    environment: attempt.environment,
    statusLabel: STATUS_LABELS[attempt.status] ?? "Unknown",
    // A finished deploy is remembered by when it landed, not when the
    // pipeline was kicked off. Until it finishes, the start is all we have.
    at: attempt.finishedAt ?? attempt.startedAt,
    duration: formatDuration(attempt.durationMs),
    isRollback: attempt.intent === "rollback",
    failed: attempt.status === DeploymentStatus.ERROR,
    inFlight: IN_FLIGHT.has(attempt.status),
  }));
}
