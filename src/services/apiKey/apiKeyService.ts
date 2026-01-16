import { ObjectId } from "mongodb";
import * as crypto from "crypto";
import * as bcrypt from "bcrypt";
import {
  ApiKeyRepository,
  ApiKey,
  ApiKeyScope,
} from "../../repositories/apiKeyRepository";
import { AccountRepository } from "../../repositories/accountRepository";

export type GenerateApiKeyInput = {
  accountId: ObjectId;
  createdByUserId: ObjectId;
  name: string;
  scopes: ApiKeyScope[];
  expiresAt?: Date | null;
};

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

    // Generate random part of the key
    const randomBytes = crypto.randomBytes(KEY_RANDOM_BYTES);
    const randomPart = randomBytes
      .toString("base64url")
      .replace(/[^A-Za-z0-9_-]/g, "");

    // Build the full key: lp_{slug}_{random}
    const fullKey = `lp_${account.slug}_${randomPart}`;

    // Create a prefix for display (first 8 chars of random)
    const keyPrefix = `lp_${account.slug}_${randomPart.slice(0, 8)}`;

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
      expiresAt: input.expiresAt,
    });

    return { key: fullKey, apiKey };
  }

  async validate(key: string): Promise<ApiKey | null> {
    // Check key format: lp_{slug}_{random}
    if (!key.startsWith("lp_")) {
      return null;
    }

    // Extract prefix (lp_{slug}_{first8chars})
    const parts = key.split("_");
    if (parts.length < 3) {
      return null;
    }
    const prefix = `${parts[0]}_${parts[1]}_${parts[2].slice(0, 8)}`;

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
