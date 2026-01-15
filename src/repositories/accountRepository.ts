import { Db, ObjectId, Collection } from "mongodb";

export type Plan = "free" | "paid";

export type PlanLimits = {
  maxRepositories: number;
  maxUsers: number;
  publicReposOnly: boolean;
};

export type Account = {
  _id: ObjectId;
  name: string;
  slug: string;
  plan: Plan;
  planLimits: PlanLimits;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  githubInstallationId: number | null;
  githubInstallationAccessToken: string | null;
  githubInstallationTokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateAccountInput = {
  name: string;
  slug: string;
};

const FREE_PLAN_LIMITS: PlanLimits = {
  maxRepositories: 1,
  maxUsers: 1,
  publicReposOnly: true,
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
      plan: "free",
      planLimits: FREE_PLAN_LIMITS,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      githubInstallationId: null,
      githubInstallationAccessToken: null,
      githubInstallationTokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.collection.insertOne(account as Account);
    return { _id: result.insertedId, ...account };
  }

  async findBySlug(slug: string): Promise<Account | null> {
    return this.collection.findOne({ slug });
  }
}
