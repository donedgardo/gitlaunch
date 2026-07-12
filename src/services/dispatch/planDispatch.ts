import { Service } from "../../repositories/serviceRepository";
import { Repository } from "../../repositories/repositoryRepository";

export type GitHubDispatchPlan = {
  kind: "github";
  installationId: number;
  owner: string;
  repo: string;
  workflowFile: string;
  buildId: string;
  environment: string;
  serviceId: string;
};

export type DispatchPlan = GitHubDispatchPlan;
// Note: Jenkins plan added Phase 9 as: export type DispatchPlan = GitHubDispatchPlan | JenkinsPlan;

export type ValidationError = {
  kind: "validation-error";
  reason: string;
};

export type PlanDispatchResult = DispatchPlan | ValidationError;

export function planDispatch(
  service: Pick<Service, "workflowFile">,
  installationId: number,
  repository: Pick<Repository, "githubOwner" | "githubRepoName">,
  buildId: string,
  environment: string,
  serviceId: string,
): PlanDispatchResult {
  if (!installationId) {
    return {
      kind: "validation-error",
      reason: "GitHub App not installed for this account",
    };
  }
  return {
    kind: "github",
    installationId,
    owner: repository.githubOwner,
    repo: repository.githubRepoName,
    workflowFile: service.workflowFile,
    buildId,
    environment,
    serviceId,
  };
}
