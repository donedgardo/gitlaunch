import { ObjectId } from "mongodb";
import * as crypto from "crypto";
import * as bcrypt from "bcrypt";
import {
  ApiKeyRepository,
  ApiKey,
  ApiKeyScope,
  ApiKeyKind,
} from "../../repositories/apiKeyRepository";
import { AccountRepository } from "../../repositories/accountRepository";

export type GenerateApiKeyInput = {
  accountId: ObjectId;
  createdByUserId: ObjectId;
  name: string;
  scopes: ApiKeyScope[];
  // Defaults to a secret (server-side) key. Publishable keys additionally
  // require serviceId, environment and at least one allowed origin.
  kind?: ApiKeyKind;
  serviceId?: ObjectId;
  environment?: string;
  allowedOrigins?: string[];
  // Secret keys only: limit which environments the key may change. Omit for
  // every environment.
  allowedEnvironments?: string[];
  expiresAt?: Date | null;
};

// The only scope a browser-visible key may carry. Anything wider (flags:read
// included — it exposes rule config, targeting rules and experiment results)
// must never leave a server.
const PUBLISHABLE_SCOPES: readonly ApiKeyScope[] = ["flags:evaluate"];

export type GenerateApiKeyResult = {
  key: string; // Full key, shown only once
  apiKey: ApiKey; // Stored record (with hash, not full key)
};

const BCRYPT_ROUNDS = 10;
const KEY_RANDOM_BYTES = 32;

export class ApiKeyService {
  constructor(
    private apiKeyRepo: ApiKeyRepository,
    private accountRepo: AccountRepository,
  ) {}

  async generate(input: GenerateApiKeyInput): Promise<GenerateApiKeyResult> {
    const account = await this.accountRepo.findById(input.accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    const kind: ApiKeyKind = input.kind ?? "secret";

    // A publishable key is handed to a browser, so refuse to mint one that
    // isn't pinned down: unbound or over-scoped keys are exactly the leak this
    // key type exists to prevent, and silently narrowing them would hide the
    // caller's mistake rather than surface it.
    if (kind === "publishable") {
      if (!input.serviceId) {
        throw new Error(
          "A publishable key must be bound to a single service (serviceId is required)",
        );
      }
      if (!input.environment) {
        throw new Error(
          "A publishable key must be bound to a single environment",
        );
      }
      if (!input.allowedOrigins?.length) {
        throw new Error(
          "A publishable key must list at least one allowed origin",
        );
      }
      // Already pinned to exactly one environment above; a second, different
      // notion of "where" on the same key could only contradict it.
      if (input.allowedEnvironments?.length) {
        throw new Error(
          "A publishable key is bound to a single environment and cannot also carry an environment list",
        );
      }
      const overreaching = input.scopes.filter(
        (s) => !PUBLISHABLE_SCOPES.includes(s),
      );
      if (overreaching.length) {
        throw new Error(
          `A publishable key may only carry the ${PUBLISHABLE_SCOPES.join(", ")} scope; refusing: ${overreaching.join(", ")}`,
        );
      }
    }

    // Generate random part of the key
    const randomBytes = crypto.randomBytes(KEY_RANDOM_BYTES);
    const randomPart = randomBytes
      .toString("base64url")
      .replace(/[^A-Za-z0-9_-]/g, "");

    // sk_ = secret (server-side only), pk_ = publishable (browser-safe), so the
    // prefix a developer sees matches how the key may actually be handled.
    const scheme = kind === "publishable" ? "pk" : "sk";
    const fullKey = `${scheme}_${account.slug}_${randomPart}`;

    // Create a prefix for display (first 8 chars of random)
    const keyPrefix = `${scheme}_${account.slug}_${randomPart.slice(0, 8)}`;

    // Hash the full key for storage
    const keyHash = await bcrypt.hash(fullKey, BCRYPT_ROUNDS);

    // Store the key record
    const apiKey = await this.apiKeyRepo.create({
      accountId: input.accountId,
      createdByUserId: input.createdByUserId,
      name: input.name,
      keyPrefix,
      keyHash,
      scopes: input.scopes,
      kind,
      serviceId: input.serviceId ?? null,
      environment: input.environment ?? null,
      allowedOrigins: input.allowedOrigins ?? [],
      allowedEnvironments: input.allowedEnvironments ?? [],
      expiresAt: input.expiresAt,
    });

    return { key: fullKey, apiKey };
  }

  async validate(key: string): Promise<ApiKey | null> {
    // Check key format: sk_{slug}_{random} or pk_{slug}_{random}. Keys minted
    // before the split all carry pk_ and are secret; the prefix is a label for
    // humans, so what a key may actually do is read from the stored record.
    if (!key.startsWith("sk_") && !key.startsWith("pk_")) {
      return null;
    }

    // Extract prefix (pk_{slug}_{first8chars}). The random segment is base64url
    // and may itself contain "_", so rejoin everything after the slug before
    // taking the first 8 chars — matching how generate() built the prefix.
    const parts = key.split("_");
    if (parts.length < 3) {
      return null;
    }
    const randomPart = parts.slice(2).join("_");
    const prefix = `${parts[0]}_${parts[1]}_${randomPart.slice(0, 8)}`;

    // Find key by prefix
    const apiKey = await this.apiKeyRepo.findByPrefix(prefix);
    if (!apiKey) {
      return null;
    }

    // Check if revoked
    if (apiKey.isRevoked) {
      return null;
    }

    // Check if expired
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return null;
    }

    // Verify the hash
    const isValid = await bcrypt.compare(key, apiKey.keyHash);
    if (!isValid) {
      return null;
    }

    // Update last used timestamp
    await this.apiKeyRepo.updateLastUsed(apiKey._id);

    return apiKey;
  }

  async revoke(apiKeyId: ObjectId): Promise<void> {
    await this.apiKeyRepo.revoke(apiKeyId);
  }

  async listByAccount(accountId: ObjectId): Promise<ApiKey[]> {
    return this.apiKeyRepo.findByAccountId(accountId);
  }
}
