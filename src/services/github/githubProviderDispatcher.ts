import { RepositoryRepository } from "../../repositories/repositoryRepository";
import {
  DispatchContext,
  ProviderDispatcher,
} from "../dispatch/providerDispatcher";
import { planDispatch } from "../dispatch/planDispatch";
import { MultiTenantGithubDispatchService } from "./githubDispatchService";

export class GithubProviderDispatcher implements ProviderDispatcher {
  readonly provider = "github" as const;

  constructor(
    private repoRepo: RepositoryRepository,
    private githubDispatch: MultiTenantGithubDispatchService,
  ) {}

  async dispatch({
    account,
    service,
    buildId,
    environment,
  }: DispatchContext): Promise<void> {
    if (!account.githubInstallationId) {
      throw new Error("GitHub App not installed for this account");
    }

    const repository = await this.repoRepo.findById(service.repositoryId);
    if (!repository) {
      throw new Error("Repository not found");
    }

    const plan = planDispatch(
      service,
      account.githubInstallationId,
      repository,
      buildId,
      environment,
      service._id.toString(),
    );
    if (plan.kind === "validation-error") {
      throw new Error(plan.reason);
    }

    const { kind: _kind, ...input } = plan;
    await this.githubDispatch.dispatch(input);
  }
}
