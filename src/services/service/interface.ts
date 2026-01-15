import { BuildRecord } from "../buildStorage/buildRecord";
import { DeploymentStatus } from "./deploymentStatus";
import { DeploymentLogRecord } from "./deploymentLogsRecord";
import { EnvironmentDeploymentsStatuses } from "./BuildDeploymentStatuses";

export interface ServiceI {
  getBuilds(): Promise<BuildRecord[]>;
  findOne(id: string): Promise<BuildRecord | null>;
  create(buildId: string): Promise<BuildRecord>;
  getName(): string;
  getEnvironments(): string[];
  updateDeploymentStatus(
    id: string,
    environment: string,
    deploymentStatus: DeploymentStatus,
  ): Promise<BuildRecord>;
  getDeploymentsLogs(buildId: string): Promise<DeploymentLogRecord[]>;
  getDeploymentStatus(buildId: string): Promise<EnvironmentDeploymentsStatuses>;
}
