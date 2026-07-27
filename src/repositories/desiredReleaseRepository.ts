import { Db, ObjectId, Collection } from "mongodb";

// The desired state of one environment: the release its agent should be
// running. This is the whole contract of the pull model — GitLaunch never
// reaches into a cluster or an edge device, it just writes down what each
// environment should be running and lets the agent that owns that environment
// converge on it.
export type DesiredRelease = {
  _id: ObjectId;
  accountId: ObjectId;
  serviceId: ObjectId;
  environment: string;
  version: string;
  // Monotonic per environment. An agent caches the last generation it applied,
  // so a poll is a cheap integer comparison rather than a manifest diff — and a
  // rollback to a previously-deployed version still reads as a change.
  generation: number;
  promotedAt: Date;
};

export type SetDesiredInput = {
  accountId: ObjectId;
  serviceId: ObjectId;
  environment: string;
  version: string;
};

export class DesiredReleaseRepository {
  private collection: Collection<DesiredRelease>;

  constructor(db: Db) {
    this.collection = db.collection<DesiredRelease>("desiredReleases");
  }

  async ensureIndexes(): Promise<void> {
    // One desired release per environment — the row is the state, and
    // promotion overwrites it rather than appending. (Promotion history is a
    // separate concern; this collection answers "what should be running now".)
    await this.collection.createIndex(
      { accountId: 1, serviceId: 1, environment: 1 },
      { unique: true },
    );
  }

  async setDesired(input: SetDesiredInput): Promise<DesiredRelease> {
    // $inc on a missing field starts at 0, so the first promotion lands on
    // generation 1. Doing this in a single upsert keeps the counter correct
    // under concurrent promotions instead of read-then-write.
    const result = await this.collection.findOneAndUpdate(
      {
        accountId: input.accountId,
        serviceId: input.serviceId,
        environment: input.environment,
      },
      {
        $set: { version: input.version, promotedAt: new Date() },
        $inc: { generation: 1 },
      },
      { upsert: true, returnDocument: "after" },
    );

    // returnDocument: "after" on an upsert always yields the document.
    return result as DesiredRelease;
  }

  async findForService(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<DesiredRelease[]> {
    return this.collection.find({ accountId, serviceId }).toArray();
  }

  async findForEnvironment(
    accountId: ObjectId,
    serviceId: ObjectId,
    environment: string,
  ): Promise<DesiredRelease | null> {
    return this.collection.findOne({ accountId, serviceId, environment });
  }

  // Shaped for planPromotion, which decides gating from the versions alone.
  async desiredVersions(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<Record<string, string>> {
    const desired = await this.findForService(accountId, serviceId);
    return Object.fromEntries(desired.map((d) => [d.environment, d.version]));
  }
}
