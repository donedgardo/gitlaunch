import { DeploymentStatus } from "../service/deploymentStatus";
import { DeploymentIntent } from "../dispatch/deploymentIntent";

/**
 * One append-only entry in a build's deployment history.
 *
 * This is the event stream the DORA four keys are measured from, so every
 * entry carries when it happened. `intent` is absent on entries written
 * before it existed, and on status changes we did not originate (a reporter
 * calling back about a deploy nobody dispatched here) — treat a missing
 * intent as "not known to be a rollback" rather than as a promote.
 */
export type DeploymentLogRecord = {
  environment: string;
  status: DeploymentStatus;
  at: Date;
  intent?: DeploymentIntent;
};
