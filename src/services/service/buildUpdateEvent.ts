import { DeploymentStatus } from "./deploymentStatus";

export type BuildUpdateEvent = {
  buildId: string;
  status: DeploymentStatus;
  serviceName: string;
  environment: string;
};
