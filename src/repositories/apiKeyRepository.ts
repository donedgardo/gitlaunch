import { Db, ObjectId, Collection } from "mongodb";

export type ApiKeyScope =
  | "builds:read"
  | "builds:write"
  | "deployments:write"
  | "services:read"
  | "services:write";

export type ApiKey = {
  _id: ObjectId;
  accountId: ObjectId;
  createdByUserId: ObjectId;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  isRevoked: boolean;
  createdAt: Date;
};

export type CreateApiKeyInput = {
  accountId: ObjectId;
  createdByUserId: ObjectId;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: readonly ApiKeyScope[];
  expiresAt?: Date | null;
};

export class ApiKeyRepository {
  private collection: Collection<ApiKey>;

  constructor(db: Db) {
    this.collection = db.collection<ApiKey>("apiKeys");
  }

  async create(input: CreateApiKeyInput): Promise<ApiKey> {
    const now = new Date();
    const apiKey: Omit<ApiKey, "_id"> = {
      accountId: input.accountId,
      createdByUserId: input.createdByUserId,
      name: input.name,
      keyPrefix: input.keyPrefix,
      keyHash: input.keyHash,
      scopes: [...input.scopes],
      lastUsedAt: null,
      expiresAt: input.expiresAt ?? null,
      isRevoked: false,
      createdAt: now,
    };

    const result = await this.collection.insertOne(apiKey as ApiKey);
    return { _id: result.insertedId, ...apiKey };
  }

  async findByPrefix(prefix: string): Promise<ApiKey | null> {
    return this.collection.findOne({ keyPrefix: prefix });
  }

  async findByAccountId(accountId: ObjectId): Promise<ApiKey[]> {
    return this.collection.find({ accountId }).toArray();
  }

  async revoke(id: ObjectId): Promise<void> {
    await this.collection.updateOne({ _id: id }, { $set: { isRevoked: true } });
  }

  async updateLastUsed(id: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      { $set: { lastUsedAt: new Date() } },
    );
  }
}
