import { DeploymentStatus } from "../service/deploymentStatus";

export type CIOutcome = "success" | "failure" | "cancelled";

export type TransitionResult = { ok: true } | { ok: false; reason: string };

export function outcomeToStatus(outcome: CIOutcome): DeploymentStatus {
  switch (outcome) {
    case "success":
      return DeploymentStatus.DEPLOYED;
    case "cancelled":
      return DeploymentStatus.CANCELLED;
    default:
      return DeploymentStatus.ERROR;
  }
}

const LEGAL_TRANSITIONS: Record<DeploymentStatus, Set<DeploymentStatus>> = {
  [DeploymentStatus.NONE]: new Set([DeploymentStatus.DISPATCHING]),
  [DeploymentStatus.DISPATCHING]: new Set([
    DeploymentStatus.DEPLOYING,
    DeploymentStatus.CANCELLED,
    DeploymentStatus.ERROR,
  ]),
  [DeploymentStatus.DEPLOYING]: new Set([
    DeploymentStatus.DEPLOYED,
    DeploymentStatus.CANCELLED,
    DeploymentStatus.ERROR,
  ]),
  [DeploymentStatus.DEPLOYED]: new Set([DeploymentStatus.DISPATCHING]),
  [DeploymentStatus.ERROR]: new Set([DeploymentStatus.DISPATCHING]),
  [DeploymentStatus.CANCELLED]: new Set([DeploymentStatus.DISPATCHING]),
};

export function isLegalTransition(
  from: DeploymentStatus,
  to: DeploymentStatus,
): TransitionResult {
  if (LEGAL_TRANSITIONS[from]?.has(to)) {
    return { ok: true };
  }
  return { ok: false, reason: `Illegal transition: ${from} -> ${to}` };
}
