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

export type JenkinsDispatchPlan = {
  kind: "jenkins";
  baseUrl: string;
  username: string;
  apiToken: string;
  jobName: string;
  buildId: string;
  environment: string;
  serviceId: string;
};

export type DispatchPlan = GitHubDispatchPlan | JenkinsDispatchPlan;

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
): GitHubDispatchPlan | ValidationError {
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

export function planJenkinsDispatch(
  connection: { baseUrl: string; username: string } | null,
  apiToken: string | null,
  jobName: string | null,
  buildId: string,
  environment: string,
  serviceId: string,
): JenkinsDispatchPlan | ValidationError {
  if (!connection || !apiToken) {
    return {
      kind: "validation-error",
      reason: "Jenkins is not connected for this account",
    };
  }
  if (!jobName) {
    return {
      kind: "validation-error",
      reason: "Jenkins job name is not configured for this service",
    };
  }
  return {
    kind: "jenkins",
    baseUrl: connection.baseUrl,
    username: connection.username,
    apiToken,
    jobName,
    buildId,
    environment,
    serviceId,
  };
}
