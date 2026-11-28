import { Db, ObjectId, Collection } from "mongodb";
import { DeploymentStatus } from "../services/service/deploymentStatus";
import { DeploymentLogRecord } from "../services/service/deploymentLogsRecord";
import { DeploymentIntent } from "../services/dispatch/deploymentIntent";
import { Actor } from "../services/service/actor";

export type Attribution = { actor?: Actor; reason?: string };

export type Build = {
  _id: ObjectId;
  accountId: ObjectId;
  serviceId: ObjectId;
  buildId: string;
  // Commit message reported alongside the build, shown on the dashboard.
  // Optional: builds reported before this existed (or by reporters that don't
  // send it) simply show the SHA on its own.
  message?: string;
  // When the change this build carries was authored, as reported by CI.
  // Lead time is measured from here, so it deliberately is not our clock:
  // the hours a commit spends queued for a runner are part of the delivery.
  // Absent for builds reported by a reporter that doesn't send it, and for
  // everything recorded before this existed.
  commitAt?: Date;
  deployments: Record<string, DeploymentStatus>;
  // When this build last went live per environment, so the board can show
  // "3d ago" next to a Live pill. Only written on the deployed transition, and
  // absent for builds that predate it (the label is simply omitted then).
  deployedAt?: Record<string, Date>;
  deploymentLogs: DeploymentLogRecord[];
  createdAt: Date;
  updatedAt: Date;
};

export type CreateBuildInput = {
  accountId: ObjectId;
  serviceId: ObjectId;
  buildId: string;
  message?: string;
  commitAt?: Date;
};

/**
 * Newest build first, with `_id` breaking ties.
 *
 * `createdAt` alone is not a total order: a CI run reporting a burst of builds
 * lands several in the same millisecond, and the storage engine is then free to
 * return them in any order — differently per query. With skip/limit that
 * silently drops builds off the end of one page without putting them on the
 * next. ObjectIds are monotonic, so `_id` descending resolves a tie as
 * insertion order reversed, which is what "newest first" means here.
 */
const NEWEST_FIRST = { createdAt: -1, _id: -1 } as const;

export type PaginatedResult = {
  builds: Build[];
  total: number;
  hasMore: boolean;
};

export class BuildRepository {
  private collection: Collection<Build>;

  constructor(db: Db) {
    this.collection = db.collection<Build>("builds");
  }

  async ensureIndexes(): Promise<void> {
    // Unique compound index for tenant isolation and duplicate prevention
    await this.collection.createIndex(
      { accountId: 1, serviceId: 1, buildId: 1 },
      { unique: true },
    );
    // Index for listing builds sorted by date. Carries the `_id` tiebreak too,
    // so NEWEST_FIRST is served by the index instead of an in-memory sort.
    await this.collection.createIndex({
      accountId: 1,
      serviceId: 1,
      createdAt: -1,
      _id: -1,
    });
  }

  async create(input: CreateBuildInput): Promise<Build> {
    // Check if build already exists for this account/repo/buildId combination
    const existing = await this.findByBuildId(
      input.accountId,
      input.serviceId,
      input.buildId,
    );
    if (existing) {
      return existing;
    }

    const now = new Date();
    const build: Omit<Build, "_id"> = {
      accountId: input.accountId,
      serviceId: input.serviceId,
      buildId: input.buildId,
      // Only persist a message when the reporter sent one, so we don't write
      // empty strings for the SHA-only case.
      ...(input.message ? { message: input.message } : {}),
      // Same reasoning as the message: absent means "not reported", which is
      // what the metrics check before falling back to `createdAt`.
      ...(input.commitAt ? { commitAt: input.commitAt } : {}),
      deployments: {},
      deploymentLogs: [],
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.collection.insertOne(build as Build);
    return { _id: result.insertedId, ...build };
  }

  async findByBuildId(
    accountId: ObjectId,
    serviceId: ObjectId,
    buildId: string,
  ): Promise<Build | null> {
    return this.collection.findOne({ accountId, serviceId, buildId });
  }

  /**
   * The build that most recently went live in an environment.
   *
   * Ordered by when it was deployed rather than by current status, so a
   * failed deploy sitting in ERROR does not make the environment look empty —
   * what is live is still whatever landed last. Builds that predate the
   * `deployedAt` stamp are invisible here and read as an empty environment.
   */
  async findLastDeployed(
    accountId: ObjectId,
    serviceId: ObjectId,
    environment: string,
  ): Promise<Build | null> {
    return this.collection.findOne(
      {
        accountId,
        serviceId,
        [`deployedAt.${environment}`]: { $exists: true },
      },
      { sort: { [`deployedAt.${environment}`]: -1 } },
    );
  }

  async findByAccountAndService(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<Build[]> {
    return this.collection
      .find({ accountId, serviceId })
      .sort(NEWEST_FIRST)
      .toArray();
  }

  async updateDeploymentStatus(
    accountId: ObjectId,
    serviceId: ObjectId,
    buildId: string,
    environment: string,
    status: DeploymentStatus,
    intent?: DeploymentIntent,
    attribution: Attribution = {},
  ): Promise<Build | null> {
    const now = new Date();
    const log: DeploymentLogRecord = {
      environment,
      status,
      at: now,
      ...(intent ? { intent } : {}),
      ...(attribution.actor ? { actor: attribution.actor } : {}),
      ...(attribution.reason ? { reason: attribution.reason } : {}),
    };

    const result = await this.collection.findOneAndUpdate(
      { accountId, serviceId, buildId },
      {
        $set: {
          [`deployments.${environment}`]: status,
          // Stamp the moment it went live so the board can say how long ago.
          // In-progress and failed states leave the previous stamp alone —
          // nothing renders it unless the environment is currently deployed.
          ...(status === DeploymentStatus.DEPLOYED
            ? { [`deployedAt.${environment}`]: now }
            : {}),
          updatedAt: now,
        },
        $push: { deploymentLogs: log },
      },
      { returnDocument: "after" },
    );

    return result;
  }

  async clearOtherDeployments(
    accountId: ObjectId,
    serviceId: ObjectId,
    excludeBuildId: string,
    environment: string,
  ): Promise<Build[]> {
    const activeStatuses = [
      DeploymentStatus.DEPLOYED,
      DeploymentStatus.DEPLOYING,
      DeploymentStatus.DISPATCHING,
    ];

    // Find affected builds before updating
    const affectedBuilds = await this.collection
      .find({
        accountId,
        serviceId,
        buildId: { $ne: excludeBuildId },
        [`deployments.${environment}`]: { $in: activeStatuses },
      })
      .toArray();

    if (affectedBuilds.length === 0) {
      return [];
    }

    const supersededAt = new Date();
    const log: DeploymentLogRecord = {
      environment,
      status: DeploymentStatus.NONE,
      at: supersededAt,
    };

    await this.collection.updateMany(
      {
        accountId,
        serviceId,
        buildId: { $ne: excludeBuildId },
        [`deployments.${environment}`]: { $in: activeStatuses },
      },
      {
        $set: {
          [`deployments.${environment}`]: DeploymentStatus.NONE,
          updatedAt: supersededAt,
        },
        $push: { deploymentLogs: log },
      },
    );

    return affectedBuilds;
  }

  async hasAnyDeployments(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<boolean> {
    // Check if any build has at least one deployment (non-empty deployments object)
    const buildWithDeployment = await this.collection.findOne({
      accountId,
      serviceId,
      $expr: { $gt: [{ $size: { $objectToArray: "$deployments" } }, 0] },
    });

    return buildWithDeployment !== null;
  }

  async findPaginated(
    accountId: ObjectId,
    serviceId: ObjectId,
    page: number,
    limit: number,
  ): Promise<PaginatedResult> {
    // Sanitize inputs
    const sanitizedPage = Math.max(1, Math.floor(page));
    const sanitizedLimit = Math.max(1, Math.min(100, Math.floor(limit)));

    // Calculate skip
    const skip = (sanitizedPage - 1) * sanitizedLimit;

    // Run query and count in parallel
    const [builds, total] = await Promise.all([
      this.collection
        .find({ accountId, serviceId })
        .sort(NEWEST_FIRST)
        .skip(skip)
        .limit(sanitizedLimit)
        .toArray(),
      this.collection.countDocuments({ accountId, serviceId }),
    ]);

    // Calculate hasMore
    const hasMore = skip + builds.length < total;

    return { builds, total, hasMore };
  }
}
