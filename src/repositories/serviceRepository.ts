import { Db, ObjectId, Collection, Filter } from "mongodb";
import { randomBytes } from "node:crypto";

export type Environment = {
  name: string;
  order: number;
};

export type CIProvider = "github" | "jenkins" | "raw";

// Provider-specific dispatch configuration. What each provider needs to trigger
// a deployment lives in its own variant — a GitHub service cannot hold a
// jobName, a Jenkins service cannot hold a workflowFile. repositoryId is the
// App-connected GitHub dispatch target, so it lives in the GitHub variant only;
// a Jenkins service has no repositoryId (commit links come from Service.repoUrl).
export type GithubDeployment = {
  provider: "github";
  repositoryId: ObjectId;
  workflowFile: string;
};

export type JenkinsDeployment = {
  provider: "jenkins";
  jobName: string;
};

// Raw webhook: GitLaunch POSTs { buildId, environment } to a customer endpoint
// to trigger a deploy. Deploy status still comes back via the reporting API.
export type RawDeployment = {
  provider: "raw";
  endpointUrl: string;
};

export type Deployment = GithubDeployment | JenkinsDeployment | RawDeployment;

export type Service = {
  _id: ObjectId;
  accountId: ObjectId;
  name: string;
  environments: Environment[];
  workflowConfigured: boolean;
  isActive: boolean;
  // Source repo URL for commit links (buildId is the SHA) — every service has
  // one regardless of provider, so a Jenkins shop never needs the GitHub App.
  repoUrl: string;
  // null until CD is configured (onboarding creates a service with just a name
  // + repoUrl, then sets the deployment in the deploy-setup step).
  deployment: Deployment | null;
  createdAt: Date;
  // Random, non-guessable identifier used as the public object key for this
  // service's published flag bundles (see BundlePublisherI) instead of the
  // real _id, which is already visible in dashboard URLs and would otherwise
  // make every customer's flag config (rollout %, unreleased keys, targeting
  // rules) enumerable with no key at all. Absent until a bundle is first
  // published; rotatable if it leaks.
  flagPublishSlug?: string | null;
};

export type CreateServiceInput = {
  accountId: ObjectId;
  name: string;
  environments?: Environment[];
  repoUrl?: string;
  // Provider-first: supply a fully-formed deployment variant...
  deployment?: Deployment;
  // ...or the GitHub shorthand (repositoryId + optional workflowFile), which
  // builds a GitHub deployment. Exactly one form is expected.
  repositoryId?: ObjectId;
  workflowFile?: string;
};

// Documents written before the Deployment value object stored dispatch config
// as flat fields (ciProvider / workflowFile / jobName / repositoryId); a Stage 2
// document has a deployment but still carried repositoryId at the top level.
// Read-time normalization reconstructs the union — folding repositoryId into the
// GitHub variant and defaulting repoUrl — so hosted data needs no migration.
type LegacyServiceFields = {
  ciProvider?: CIProvider;
  workflowFile?: string;
  jobName?: string | null;
  repositoryId?: ObjectId;
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
    // Provider-first callers pass a deployment; the GitHub shorthand builds one
    // from repositoryId. With neither, CD is not configured yet (null) — the
    // onboarding step-1 shape (name + repoUrl only).
    const deployment: Deployment | null = input.deployment
      ? input.deployment
      : input.repositoryId
        ? {
            provider: "github",
            repositoryId: input.repositoryId,
            workflowFile: input.workflowFile || "deploy.yml",
          }
        : null;
    const service: Omit<Service, "_id"> = {
      accountId: input.accountId,
      name: input.name,
      environments: input.environments || DEFAULT_ENVIRONMENTS,
      workflowConfigured: false,
      isActive: true,
      repoUrl: input.repoUrl || "",
      deployment,
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
    const legacy = service as Service & LegacyServiceFields;
    // Distinguish an explicit null (CD not configured yet) from a missing field
    // on a legacy document (reconstruct from the flat fields).
    const stored = (service as { deployment?: Deployment | null }).deployment;

    if (stored === null) {
      return { ...service, repoUrl, deployment: null };
    }

    let deployment: Deployment;
    if (stored === undefined) {
      // Pre-Stage-2 flat document: reconstruct the whole union.
      deployment =
        legacy.ciProvider === "jenkins"
          ? { provider: "jenkins", jobName: legacy.jobName ?? "" }
          : {
              provider: "github",
              repositoryId: legacy.repositoryId as ObjectId,
              workflowFile: legacy.workflowFile ?? "deploy.yml",
            };
    } else if (
      stored.provider === "github" &&
      !(stored as Partial<GithubDeployment>).repositoryId
    ) {
      // Stage 2 document: the GitHub variant existed but repositoryId still
      // lived at the top level — fold it into the variant.
      deployment = {
        provider: "github",
        repositoryId: legacy.repositoryId as ObjectId,
        workflowFile: stored.workflowFile,
      };
    } else {
      deployment = stored;
    }

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
    // repositoryId is the GitHub dispatch target, held inside the deployment
    // variant; also match legacy documents that still carry it at the top level.
    return this.normalizeMany(
      await this.collection
        .find({
          accountId,
          $or: [{ "deployment.repositoryId": repositoryId }, { repositoryId }],
        } as Filter<Service>)
        .toArray(),
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

  // Replace a service's deployment with a fully-formed variant. The caller owns
  // building it (e.g. a GitHub deployment must supply its dispatch-target repo).
  async setDeployment(
    accountId: ObjectId,
    id: ObjectId,
    deployment: Deployment,
  ): Promise<Service | null> {
    return this.normalize(
      await this.collection.findOneAndUpdate(
        { _id: id, accountId },
        {
          // Explicitly choosing a deployment (a GitHub variant carries its
          // workflow file) IS configuring it — so the dashboard doesn't re-nag
          // "set up your deploy workflow" after deploy setup completes.
          $set: { deployment, workflowConfigured: true },
          $unset: {
            ciProvider: "",
            jobName: "",
            workflowFile: "",
            repositoryId: "",
          },
        },
        { returnDocument: "after" },
      ),
    );
  }

  async updateWorkflowConfiguration(
    id: ObjectId,
    config: { workflowFile: string },
  ): Promise<Service | null> {
    // Configuring a workflow file is inherently a GitHub deployment operation;
    // preserve the existing dispatch-target repo on the GitHub variant.
    const current = this.normalize(await this.collection.findOne({ _id: id }));
    if (!current) {
      return null;
    }
    if (current.deployment?.provider !== "github") {
      return current;
    }

    return this.normalize(
      await this.collection.findOneAndUpdate(
        { _id: id },
        {
          $set: {
            deployment: {
              provider: "github",
              repositoryId: current.deployment.repositoryId,
              workflowFile: config.workflowFile,
            },
            workflowConfigured: true,
          },
          $unset: {
            ciProvider: "",
            jobName: "",
            workflowFile: "",
            repositoryId: "",
          },
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

  private generateFlagPublishSlug(): string {
    return randomBytes(16).toString("base64url");
  }

  // Returns the service's current flag-publish slug, minting one on first use.
  // A conditional "set if unset" update means two concurrent flag writes can
  // race this and still converge on a single slug: the loser's $setOnInsert
  // is a no-op against Mongo, and re-reading afterward returns whatever won.
  async ensureFlagPublishSlug(id: ObjectId): Promise<string> {
    const existing = await this.collection.findOne(
      { _id: id },
      { projection: { flagPublishSlug: 1 } },
    );
    if (existing?.flagPublishSlug) {
      return existing.flagPublishSlug;
    }

    await this.collection.updateOne(
      { _id: id, flagPublishSlug: { $in: [null, undefined] } },
      { $set: { flagPublishSlug: this.generateFlagPublishSlug() } },
    );
    const current = await this.collection.findOne(
      { _id: id },
      { projection: { flagPublishSlug: 1 } },
    );
    return current!.flagPublishSlug!;
  }

  // Mints a brand new slug, orphaning the old one (its bundle URL simply stops
  // resolving to anything readable — nothing needs active deletion).
  async rotateFlagPublishSlug(
    accountId: ObjectId,
    id: ObjectId,
  ): Promise<string> {
    const slug = this.generateFlagPublishSlug();
    await this.collection.updateOne(
      { _id: id, accountId },
      { $set: { flagPublishSlug: slug } },
    );
    return slug;
  }

  async delete(id: ObjectId): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: id });
    return result.deletedCount === 1;
  }
}
