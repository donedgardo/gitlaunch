import { BuildRecord } from "./buildRecord";
import { DeploymentStatus } from "../service/deploymentStatus";

export interface BuildStorageI {
  getBuilds(): Promise<BuildRecord[]>;
  create(buildId: string): Promise<BuildRecord>;
  getBuild(id: string): Promise<BuildRecord | null>;
  updateDeploymentStatus(
    id: string,
    environment: string,
    status: DeploymentStatus,
  ): Promise<BuildRecord[]>;
}
