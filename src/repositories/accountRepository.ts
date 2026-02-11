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
  paymentFailedAt: Date | null;
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
  maxRepositories: 3,
  maxServices: 3,
  maxUsers: 1,
  publicReposOnly: true,
};

export const PRO_PLAN_LIMITS: PlanLimits = {
  maxRepositories: 10,
  maxServices: 10,
  maxUsers: 5,
  publicReposOnly: false,
};

export const TEAM_PLAN_LIMITS: PlanLimits = {
  maxRepositories: 999,
  maxServices: 999,
  maxUsers: 999,
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

  async findById(id: ObjectId): Promise<Account | null> {
    return this.collection.findOne({ _id: id });
  }

  async updateInstallation(
    id: ObjectId,
    installationId: number,
  ): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          githubInstallationId: installationId,
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
    return this.collection.findOne({ stripeSubscriptionId: subscriptionId });
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
}
