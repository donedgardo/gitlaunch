import { DeploymentStatus } from "./deploymentStatus";

type Environments = string;
type BuildId = string;
export type EnvironmentDeploymentsStatuses = Record<
  Environments,
  DeploymentStatus
>;
export type BuildDeploymentStatuses = Record<
  BuildId,
  EnvironmentDeploymentsStatuses
>;
