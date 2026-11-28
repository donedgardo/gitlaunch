import { Db, ObjectId, Collection } from "mongodb";

export type ApiKeyScope =
  | "builds:read"
  | "builds:write"
  | "deployments:write"
  | "services:read"
  | "services:write"
  // Narrower than flags:read on purpose: evaluating flags for one entity tells
  // you a decision, while flags:read also exposes rule config, targeting rules,
  // experiment results and config bundles. Only the former is browser-safe.
  | "flags:evaluate"
  | "flags:read"
  | "flags:write";

// "secret" keys are full-power and must stay server-side. "publishable" keys are
// the only ones we consider safe to ship inside a browser bundle, and are always
// bound to a single service + environment with an origin allow-list.
// Absent on records minted before the split, which are secret by definition.
export type ApiKeyKind = "secret" | "publishable";

export type ApiKey = {
  _id: ObjectId;
  accountId: ObjectId;
  createdByUserId: ObjectId;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  kind?: ApiKeyKind;
  // Publishable keys only: the single service/environment they may evaluate,
  // and the origins a browser may present them from.
  serviceId?: ObjectId | null;
  environment?: string | null;
  allowedOrigins?: string[];
  // Secret keys only: the environments this key may change. Absent or empty
  // means every environment, which is what all keys were before this existed.
  // Reads are never limited by it.
  allowedEnvironments?: string[];
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
  kind?: ApiKeyKind;
  serviceId?: ObjectId | null;
  environment?: string | null;
  allowedOrigins?: string[];
  allowedEnvironments?: string[];
  expiresAt?: Date | null;
};

// A record with no explicit kind predates the sk_/pk_ split and is a secret key.
export function isPublishable(key: Pick<ApiKey, "kind">): boolean {
  return key.kind === "publishable";
}

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
      kind: input.kind ?? "secret",
      serviceId: input.serviceId ?? null,
      environment: input.environment ?? null,
      allowedOrigins: input.allowedOrigins ?? [],
      allowedEnvironments: input.allowedEnvironments ?? [],
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
