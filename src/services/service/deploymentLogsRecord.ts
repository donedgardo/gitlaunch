import { DeploymentStatus } from "../service/deploymentStatus";
import { DeploymentIntent } from "../dispatch/deploymentIntent";
import { Actor } from "./actor";

/**
 * One append-only entry in a build's deployment history.
 *
 * This is the event stream the DORA four keys are measured from, so every
 * entry carries when it happened. `intent` is absent on entries written
 * before it existed, and on status changes we did not originate (a reporter
 * calling back about a deploy nobody dispatched here) — treat a missing
 * intent as "not known to be a rollback" rather than as a promote.
 *
 * `actor` is who made this change, and `reason` is why, in their words when
 * they gave one. Both are absent on entries written before attribution
 * existed, and on entries the system writes itself (a build superseded by
 * another going live). Read "who shipped this" through `shippedBy`, not off a
 * single entry: the pipeline that reports a deploy landed is rarely the one
 * who decided it should go out.
 */
export type DeploymentLogRecord = {
  environment: string;
  status: DeploymentStatus;
  at: Date;
  intent?: DeploymentIntent;
  actor?: Actor;
  reason?: string;
};
