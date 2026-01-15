import { DeploymentStatus } from "../service/deploymentStatus";

export type DeploymentLogRecord = {
  environment: string;
  status: DeploymentStatus;
};
