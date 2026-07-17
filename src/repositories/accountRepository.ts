import { Db, ObjectId, Collection } from "mongodb";

export enum Plan {
  Free = "free",
  Pro = "pro",
  Team = "team",
}

export type PlanLimits = {
  maxRepositories: number;
  maxServices: number;
  maxUsers: number;
  maxEnvironments: number;
  publicReposOnly: boolean;
};

export type JenkinsConnection = {
  baseUrl: string;
  username: string;
  apiTokenEncrypted: string; // ciphertext only — never plaintext
  updatedAt: Date;
};

export type GithubConnection = {
  installationId: number;
  connectedAt: Date;
};

export type Account = {
  _id: ObjectId;
  name: string;
  slug: string;
  plan: Plan;
  planLimits: PlanLimits;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  paymentFailedAt: Date | null;
  trialEndsAt: Date | null;
  githubConnection: GithubConnection | null;
  jenkinsConnection: JenkinsConnection | null;
  createdAt: Date;
  updatedAt: Date;
};

// Documents written before the GithubConnection value object stored the
// installation as a flat `githubInstallationId`. Read-time normalization keeps
// those readable without a data migration.
type LegacyAccountFields = { githubInstallationId?: number | null };

export type CreateAccountInput = {
  name: string;
  slug: string;
};

const FREE_PLAN_LIMITS: PlanLimits = {
  maxRepositories: 3,
  maxServices: 3,
  maxUsers: 1,
  maxEnvironments: 2,
  publicReposOnly: true,
};

export const PRO_PLAN_LIMITS: PlanLimits = {
  maxRepositories: 10,
  maxServices: 10,
  maxUsers: 5,
  maxEnvironments: 10,
  publicReposOnly: false,
};

export const TEAM_PLAN_LIMITS: PlanLimits = {
  maxRepositories: 999,
  maxServices: 999,
  maxUsers: 999,
  maxEnvironments: 999,
  publicReposOnly: false,
};

export const PLAN_LIMITS_MAP: Record<Plan, PlanLimits> = {
  [Plan.Free]: FREE_PLAN_LIMITS,
  [Plan.Pro]: PRO_PLAN_LIMITS,
  [Plan.Team]: TEAM_PLAN_LIMITS,
};

export class AccountRepository {
  private collection: Collection<Account>;

  constructor(db: Db) {
    this.collection = db.collection<Account>("accounts");
  }

  async create(input: CreateAccountInput): Promise<Account> {
    // Check for duplicate slug
    const existing = await this.findBySlug(input.slug);
    if (existing) {
      throw new Error(`Account with slug '${input.slug}' already exists`);
    }

    const now = new Date();
    const account: Omit<Account, "_id"> = {
      ...input,
      plan: Plan.Free,
      planLimits: FREE_PLAN_LIMITS,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      paymentFailedAt: null,
      trialEndsAt: null,
      githubConnection: null,
      jenkinsConnection: null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.collection.insertOne(account as Account);
    return { _id: result.insertedId, ...account };
  }

  // Reconstructs the GithubConnection value object from a legacy flat
  // `githubInstallationId` document so hosted data needs no migration.
  private normalize(account: Account | null): Account | null {
    if (!account) {
      return null;
    }
    if (account.githubConnection) {
      return account;
    }
    const legacyId = (account as Account & LegacyAccountFields)
      .githubInstallationId;
    return {
      ...account,
      githubConnection:
        legacyId != null
          ? { installationId: legacyId, connectedAt: account.createdAt }
          : null,
    };
  }

  async findBySlug(slug: string): Promise<Account | null> {
    return this.normalize(await this.collection.findOne({ slug }));
  }

  async findById(id: ObjectId): Promise<Account | null> {
    return this.normalize(await this.collection.findOne({ _id: id }));
  }

  async updateInstallation(
    id: ObjectId,
    installationId: number,
  ): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          githubConnection: {
            installationId,
            connectedAt: new Date(),
          },
          updatedAt: new Date(),
        },
        $unset: { githubInstallationId: "" },
      },
    );
  }

  async clearGithubConnection(id: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          githubConnection: null,
          updatedAt: new Date(),
        },
        $unset: { githubInstallationId: "" },
      },
    );
  }

  async setJenkinsConnection(
    id: ObjectId,
    connection: Omit<JenkinsConnection, "updatedAt">,
  ): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          jenkinsConnection: {
            baseUrl: connection.baseUrl,
            username: connection.username,
            apiTokenEncrypted: connection.apiTokenEncrypted,
            updatedAt: new Date(),
          },
          updatedAt: new Date(),
        },
      },
    );
  }

  async clearJenkinsConnection(id: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          jenkinsConnection: null,
          updatedAt: new Date(),
        },
      },
    );
  }

  async upgradeToPlan(
    id: ObjectId,
    stripeCustomerId: string,
    stripeSubscriptionId: string,
    plan: Plan,
  ): Promise<void> {
    if (plan === Plan.Free) {
      throw new Error("Cannot upgrade to Free plan");
    }

    const planLimits = PLAN_LIMITS_MAP[plan];

    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          plan,
          planLimits,
          stripeCustomerId,
          stripeSubscriptionId,
          paymentFailedAt: null,
          trialEndsAt: null,
          updatedAt: new Date(),
        },
      },
    );
  }

  async selectPlan(id: ObjectId, plan: Plan): Promise<void> {
    const planLimits = PLAN_LIMITS_MAP[plan];

    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          plan,
          planLimits,
          updatedAt: new Date(),
        },
      },
    );
  }

  async downgradeToFree(id: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          plan: Plan.Free,
          planLimits: FREE_PLAN_LIMITS,
          stripeSubscriptionId: null,
          paymentFailedAt: null,
          updatedAt: new Date(),
        },
      },
    );
  }

  async findBySubscriptionId(subscriptionId: string): Promise<Account | null> {
    return this.normalize(
      await this.collection.findOne({ stripeSubscriptionId: subscriptionId }),
    );
  }

  async setPaymentFailed(id: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          paymentFailedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
  }

  async clearPaymentFailed(id: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          paymentFailedAt: null,
          updatedAt: new Date(),
        },
      },
    );
  }

  async setTrialEndsAt(id: ObjectId, trialEndsAt: Date | null): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          trialEndsAt,
          updatedAt: new Date(),
        },
      },
    );
  }
}
