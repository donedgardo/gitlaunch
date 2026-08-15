import { DeploymentStatus } from "../service/deploymentStatus";
import { DeploymentIntent } from "../dispatch/deploymentIntent";

/**
 * One deployment outcome, flattened out of a build's deployment log.
 *
 * Pure input: the caller reads builds and maps their `deploymentLogs` into
 * this shape. Nothing here touches Mongo, so the measurement rules can be
 * argued about in tests rather than in a query.
 */
export type DeploymentEvent = {
  buildId: string;
  environment: string;
  status: DeploymentStatus;
  /** When this status was recorded. */
  at: Date;
  /**
   * When the change being deployed was authored.
   *
   * The caller passes the commit time the reporter sent, falling back to the
   * build's `createdAt` when it sent none. On the fallback path lead time is
   * "reported to live" rather than the DORA "committed to live", and so reads
   * as a floor on the real number.
   */
  changeAt: Date;
  /**
   * Where `changeAt` came from. `"commit"` means CI reported when the change
   * was authored, so the lead time it produces is the DORA number. Anything
   * else means we fell back to our own clock, and the panel has to say so
   * rather than pass a floor off as the real thing.
   */
  changeAtSource?: "commit" | "first-seen";
  intent?: DeploymentIntent;
};

export type MeasurementWindow = { from: Date; to: Date };

export type FourKeys = {
  /** Deployments that reached the environment, per day across the window. */
  deploymentFrequencyPerDay: number;
  /** Median time from change authored to change live. Null if nothing shipped. */
  medianLeadTimeMs: number | null;
  /** Share of changes that broke: rolled back, or failed on the way out. 0–1. */
  changeFailureRate: number | null;
  /** Median time from a failed deployment to the next one that landed. */
  medianTimeToRestoreMs: number | null;
  /**
   * How much evidence each number rests on.
   *
   * At low volume these metrics are noise, and a dashboard that renders
   * "33% change failure rate" off three deploys invites exactly the wrong
   * conversation. Carry the denominators so the UI can say n.
   */
  sample: {
    deployments: number;
    failures: number;
    restores: number;
    leadTimes: number;
    /**
     * How many of those lead times were measured from a reported commit time.
     * Short of `leadTimes`, the median is partly our receive clock and the
     * panel says which — see `DeploymentEvent.changeAtSource`.
     */
    leadTimesFromCommit: number;
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** A deploy that resolved one way or the other. Cancelled never shipped. */
const isOutcome = (e: DeploymentEvent) =>
  e.status === DeploymentStatus.DEPLOYED || e.status === DeploymentStatus.ERROR;

const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function computeFourKeys(
  events: readonly DeploymentEvent[],
  environment: string,
  window: MeasurementWindow,
): FourKeys {
  const timeline = events
    .filter(
      (e) =>
        e.environment === environment &&
        e.at.getTime() >= window.from.getTime() &&
        e.at.getTime() <= window.to.getTime(),
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const outcomes = timeline.filter(isOutcome);
  const landed = outcomes.filter((e) => e.status === DeploymentStatus.DEPLOYED);

  // A rollback is a deployment, but it is not a *change* — it delivers
  // something the team already shipped. It counts toward frequency and it
  // ends an outage, but it is neither a lead-time sample nor a denominator
  // for change failure rate.
  const isRollback = (e: DeploymentEvent) => e.intent === "rollback";
  const changes = outcomes.filter((e) => !isRollback(e));

  const windowDays = Math.max(
    0,
    (window.to.getTime() - window.from.getTime()) / DAY_MS,
  );

  // Lead time: first time each change reached the environment.
  const seen = new Set<string>();
  const leadTimes: number[] = [];
  let leadTimesFromCommit = 0;
  for (const e of landed) {
    if (isRollback(e) || seen.has(e.buildId)) {
      continue;
    }
    seen.add(e.buildId);
    const leadTime = e.at.getTime() - e.changeAt.getTime();
    // A change cannot go live before it was written. When it looks that way
    // the commit time came off a clock that disagrees with ours, and the
    // honest thing is to drop the sample: counting it would subtract from the
    // median and make delivery look faster than it is.
    if (leadTime < 0) {
      continue;
    }
    leadTimes.push(leadTime);
    if (e.changeAtSource === "commit") {
      leadTimesFromCommit += 1;
    }
  }

  // Failures: a change that errored on the way out, or one that had to be
  // undone. The culprit of a rollback is the last change that shipped before
  // it — you roll back the thing that just broke.
  const failures = new Set<DeploymentEvent>();
  for (const e of outcomes) {
    if (e.status === DeploymentStatus.ERROR) {
      failures.add(e);
    }
  }
  for (const rollback of landed.filter(isRollback)) {
    const culprit = [...changes]
      .reverse()
      .find((c) => c.at.getTime() < rollback.at.getTime());
    if (culprit) {
      failures.add(culprit);
    }
  }

  // Recovery: from a failed deployment to the next one that landed —
  // whether the team rolled back or fixed forward. A failure with nothing
  // after it is an outage still running; it has no recovery time yet, and
  // reporting it as zero would flatter the number.
  const restores: number[] = [];
  for (const failure of failures) {
    const restore = landed.find(
      (e) => e.at.getTime() > failure.at.getTime() && e !== failure,
    );
    if (restore) {
      restores.push(restore.at.getTime() - failure.at.getTime());
    }
  }

  return {
    deploymentFrequencyPerDay: windowDays > 0 ? landed.length / windowDays : 0,
    medianLeadTimeMs: median(leadTimes),
    changeFailureRate:
      changes.length > 0 ? failures.size / changes.length : null,
    medianTimeToRestoreMs: median(restores),
    sample: {
      deployments: landed.length,
      failures: failures.size,
      restores: restores.length,
      leadTimes: leadTimes.length,
      leadTimesFromCommit,
    },
  };
}
