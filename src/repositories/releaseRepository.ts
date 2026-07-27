import { Db, ObjectId, Collection, MongoServerError } from "mongodb";
import { ReleaseArtifact } from "../services/release/release";

export type Release = {
  _id: ObjectId;
  accountId: ObjectId;
  serviceId: ObjectId;
  // Unique per service. Two services in an account may both ship "1.0.0".
  version: string;
  // Provenance: the commit the artifacts were built from, for dashboard links.
  commitSha: string;
  artifacts: ReleaseArtifact[];
  createdAt: Date;
};

export type CreateReleaseInput = {
  accountId: ObjectId;
  serviceId: ObjectId;
  version: string;
  commitSha: string;
  artifacts: ReleaseArtifact[];
};

// Cutting a release either succeeds or is refused — there is no third state
// where an existing release is silently overwritten. Immutability is the whole
// point: an agent that reconciles "prod wants 1.4.2" days later must resolve
// the same artifacts, so a re-cut is an error, not an update.
export type CreateReleaseResult =
  | { created: true; release: Release }
  | { created: false; reason: string };

export class ReleaseRepository {
  private collection: Collection<Release>;

  constructor(db: Db) {
    this.collection = db.collection<Release>("releases");
  }

  async ensureIndexes(): Promise<void> {
    // Immutability is enforced by the database, not by a read-then-write in
    // application code, so concurrent cuts of the same version cannot both win.
    await this.collection.createIndex(
      { accountId: 1, serviceId: 1, version: 1 },
      { unique: true },
    );
    // Listing a service's releases newest first.
    await this.collection.createIndex({
      accountId: 1,
      serviceId: 1,
      createdAt: -1,
    });
  }

  async create(input: CreateReleaseInput): Promise<CreateReleaseResult> {
    const release: Omit<Release, "_id"> = {
      accountId: input.accountId,
      serviceId: input.serviceId,
      version: input.version,
      commitSha: input.commitSha,
      artifacts: input.artifacts,
      createdAt: new Date(),
    };

    try {
      const result = await this.collection.insertOne(release as Release);
      return { created: true, release: { _id: result.insertedId, ...release } };
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        return {
          created: false,
          reason: `Release ${input.version} already exists`,
        };
      }
      throw error;
    }
  }

  async findByVersion(
    accountId: ObjectId,
    serviceId: ObjectId,
    version: string,
  ): Promise<Release | null> {
    return this.collection.findOne({ accountId, serviceId, version });
  }

  async listForService(
    accountId: ObjectId,
    serviceId: ObjectId,
    limit = 20,
  ): Promise<Release[]> {
    return (
      this.collection
        .find({ accountId, serviceId })
        // _id breaks ties: releases cut in the same millisecond would otherwise
        // come back in an arbitrary order, and ObjectIds are monotonic.
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .toArray()
    );
  }
}
