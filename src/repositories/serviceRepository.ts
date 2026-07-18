import { Db, ObjectId, Collection } from "mongodb";

export type Environment = {
  name: string;
  order: number;
};

export type CIProvider = "github" | "jenkins";

// Provider-specific dispatch configuration. What each provider needs to trigger
// a deployment lives in its own variant — a GitHub service cannot hold a
// jobName, a Jenkins service cannot hold a workflowFile. repositoryId is NOT
// here: it is the service's source repo (commit links for every build, plus the
// GitHub dispatch target) and lives on Service.
export type GithubDeployment = {
  provider: "github";
  workflowFile: string;
};

export type JenkinsDeployment = {
  provider: "jenkins";
  jobName: string;
};

export type Deployment = GithubDeployment | JenkinsDeployment;

export type Service = {
  _id: ObjectId;
  accountId: ObjectId;
  repositoryId: ObjectId;
  name: string;
  environments: Environment[];
  workflowConfigured: boolean;
  isActive: boolean;
  // Source repo URL for commit links (buildId is the SHA) — every service has
  // one regardless of provider, so a Jenkins shop never needs the GitHub App.
  repoUrl: string;
  deployment: Deployment;
  createdAt: Date;
};

export type CreateServiceInput = {
  accountId: ObjectId;
  repositoryId: ObjectId;
  name: string;
  environments?: Environment[];
  workflowFile?: string;
  repoUrl?: string;
};

// Documents written before the Deployment value object stored dispatch config
// as flat fields (ciProvider / workflowFile / jobName). Read-time normalization
// reconstructs the union — and defaults repoUrl — so hosted data needs no
// migration.
type LegacyServiceFields = {
  ciProvider?: CIProvider;
  workflowFile?: string;
  jobName?: string | null;
};

const DEFAULT_ENVIRONMENTS: Environment[] = [
  { name: "staging", order: 0 },
  { name: "prod", order: 1 },
];

export class ServiceRepository {
  private collection: Collection<Service>;

  constructor(db: Db) {
    this.collection = db.collection<Service>("services");
  }

  async ensureIndexes(): Promise<void> {
    // Unique compound index: one service name per account (dashboard routes by
    // service name, so names must be unique regardless of source repo).
    await this.collection.createIndex(
      { accountId: 1, name: 1 },
      { unique: true },
    );
  }

  async create(input: CreateServiceInput): Promise<Service> {
    const now = new Date();
    // New services default to a GitHub deployment; provider-first creation
    // arrives in the wizard work (Stage 3).
    const service: Omit<Service, "_id"> = {
      accountId: input.accountId,
      repositoryId: input.repositoryId,
      name: input.name,
      environments: input.environments || DEFAULT_ENVIRONMENTS,
      workflowConfigured: false,
      isActive: true,
      repoUrl: input.repoUrl || "",
      deployment: {
        provider: "github",
        workflowFile: input.workflowFile || "deploy.yml",
      },
      createdAt: now,
    };

    const result = await this.collection.insertOne(service as Service);
    return { _id: result.insertedId, ...service };
  }

  // Legacy services stored dispatch config as flat fields; reconstruct the
  // Deployment value object at read time so no data migration is required.
  private normalize(service: Service | null): Service | null {
    if (!service) {
      return null;
    }
    const repoUrl = service.repoUrl ?? "";
    if (service.deployment) {
      return { ...service, repoUrl };
    }
    const legacy = service as Service & LegacyServiceFields;
    const deployment: Deployment =
      legacy.ciProvider === "jenkins"
        ? { provider: "jenkins", jobName: legacy.jobName ?? "" }
        : {
            provider: "github",
            workflowFile: legacy.workflowFile ?? "deploy.yml",
          };
    return { ...service, repoUrl, deployment };
  }

  private normalizeMany(services: Service[]): Service[] {
    return services.map((s) => this.normalize(s) as Service);
  }

  async findById(id: ObjectId): Promise<Service | null> {
    return this.normalize(await this.collection.findOne({ _id: id }));
  }

  async findByAccountAndId(
    accountId: ObjectId,
    id: ObjectId,
  ): Promise<Service | null> {
    return this.normalize(
      await this.collection.findOne({ _id: id, accountId }),
    );
  }

  async findByRepositoryId(
    accountId: ObjectId,
    repositoryId: ObjectId,
  ): Promise<Service[]> {
    return this.normalizeMany(
      await this.collection.find({ accountId, repositoryId }).toArray(),
    );
  }

  async findByAccountId(accountId: ObjectId): Promise<Service[]> {
    return this.normalizeMany(
      await this.collection.find({ accountId }).toArray(),
    );
  }

  async findByAccountIdAndName(
    accountId: ObjectId,
    name: string,
  ): Promise<Service | null> {
    return this.normalize(await this.collection.findOne({ accountId, name }));
  }

  async setProvider(
    accountId: ObjectId,
    id: ObjectId,
    provider: { ciProvider: CIProvider; jobName: string | null },
  ): Promise<Service | null> {
    let deployment: Deployment;
    if (provider.ciProvider === "jenkins") {
      deployment = { provider: "jenkins", jobName: provider.jobName ?? "" };
    } else {
      // Preserve an existing GitHub workflow file across a github→github save;
      // default it when switching over from Jenkins (which carries no workflow).
      const current = this.normalize(
        await this.collection.findOne({ _id: id, accountId }),
      );
      const workflowFile =
        current?.deployment.provider === "github"
          ? current.deployment.workflowFile
          : "deploy.yml";
      deployment = { provider: "github", workflowFile };
    }

    return this.normalize(
      await this.collection.findOneAndUpdate(
        { _id: id, accountId },
        {
          $set: { deployment },
          $unset: { ciProvider: "", jobName: "", workflowFile: "" },
        },
        { returnDocument: "after" },
      ),
    );
  }

  async updateWorkflowConfiguration(
    id: ObjectId,
    config: { workflowFile: string },
  ): Promise<Service | null> {
    // Configuring a workflow file is inherently a GitHub deployment operation.
    return this.normalize(
      await this.collection.findOneAndUpdate(
        { _id: id },
        {
          $set: {
            deployment: {
              provider: "github",
              workflowFile: config.workflowFile,
            },
            workflowConfigured: true,
          },
          $unset: { ciProvider: "", jobName: "", workflowFile: "" },
        },
        { returnDocument: "after" },
      ),
    );
  }

  async markWorkflowConfigured(id: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      { $set: { workflowConfigured: true } },
    );
  }

  async addEnvironment(
    id: ObjectId,
    env: Environment,
  ): Promise<Service | null> {
    const result = await this.collection.findOneAndUpdate(
      { _id: id },
      { $push: { environments: env } },
      { returnDocument: "after" },
    );
    return this.normalize(result);
  }

  async updateEnvironment(
    id: ObjectId,
    envName: string,
    updates: { order?: number },
  ): Promise<Service | null> {
    const setFields: Record<string, number> = {};
    if (updates.order !== undefined) {
      setFields["environments.$.order"] = updates.order;
    }

    // If no fields to update, just return the current document
    if (Object.keys(setFields).length === 0) {
      return this.findById(id);
    }

    const result = await this.collection.findOneAndUpdate(
      { _id: id, "environments.name": envName },
      { $set: setFields },
      { returnDocument: "after" },
    );

    // If no match (environment not found), return the service as-is
    if (!result) {
      return this.findById(id);
    }

    return this.normalize(result);
  }

  async removeEnvironment(
    id: ObjectId,
    envName: string,
  ): Promise<Service | null> {
    const result = await this.collection.findOneAndUpdate(
      { _id: id },
      { $pull: { environments: { name: envName } } },
      { returnDocument: "after" },
    );
    return this.normalize(result);
  }

  async delete(id: ObjectId): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: id });
    return result.deletedCount === 1;
  }
}
