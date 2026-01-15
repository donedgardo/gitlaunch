import { EnvironmentDeploymentsStatuses } from "../service/BuildDeploymentStatuses";
import { DeploymentLogRecord } from "../service/deploymentLogsRecord";

export type BuildRecord = {
  id: string;
  deployments: EnvironmentDeploymentsStatuses;
  deploymentLogs: DeploymentLogRecord[];
  created_at: Date;
};
