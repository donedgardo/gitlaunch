import { AccountRepository, Plan } from "../../repositories/accountRepository";
import {
  RepositoryRepository,
  Repository,
  CreateRepositoryInput,
} from "../../repositories/repositoryRepository";

export class RepositoryService {
  constructor(
    private accountRepo: AccountRepository,
    private repoRepo: RepositoryRepository,
  ) {}

  async addRepository(input: CreateRepositoryInput): Promise<Repository> {
    const account = await this.accountRepo.findById(input.accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    // Check private repo restriction
    if (input.isPrivate && account.planLimits.publicReposOnly) {
      throw new Error("Private repositories require a paid plan.");
    }

    // Check for duplicate repo (monorepo support)
    const existingRepo = await this.repoRepo.findByAccountIdAndGithubRepoId(
      input.accountId,
      input.githubRepoId,
    );
    if (existingRepo && account.plan === Plan.Free) {
      throw new Error(
        "Monorepo support requires a paid plan. Upgrade to add the same repository multiple times.",
      );
    }

    // Check repo count limit
    const existingRepos = await this.repoRepo.findByAccountId(input.accountId);
    if (existingRepos.length >= account.planLimits.maxRepositories) {
      throw new Error(
        "Repository limit reached. Upgrade your plan to add more repositories.",
      );
    }

    return this.repoRepo.create(input);
  }
}
