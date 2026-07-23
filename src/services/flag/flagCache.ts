import type { Flag } from "../../repositories/flagRepository";

// Cache of a service's flag configs, keyed by `${accountId}:${serviceId}`.
// Evaluation is on the application hot path, so we read flag configs through a
// cache and fall back to Mongo only on a miss. Writes invalidate the entry for
// immediate consistency; a short TTL bounds staleness if an invalidation is
// ever missed (e.g. across instances before a shared Redis is wired up).
export interface FlagCacheI {
  get(key: string): Promise<Flag[] | null>;
  set(key: string, flags: Flag[]): Promise<void>;
  invalidate(key: string): Promise<void>;
}

const DEFAULT_TTL_MS = 30_000;

type Entry = { flags: Flag[]; expiresAt: number };

export class InMemoryFlagCache implements FlagCacheI {
  private store = new Map<string, Entry>();
  private ttlMs: number;
  private now: () => number;

  constructor(opts?: { ttlMs?: number; now?: () => number }) {
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts?.now ?? Date.now;
  }

  async get(key: string): Promise<Flag[] | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.flags;
  }

  async set(key: string, flags: Flag[]): Promise<void> {
    this.store.set(key, { flags, expiresAt: this.now() + this.ttlMs });
  }

  async invalidate(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// Always-miss cache — disables caching without branching in the service.
export class NoOpFlagCache implements FlagCacheI {
  async get(_key: string): Promise<Flag[] | null> {
    return null;
  }
  async set(_key: string, _flags: Flag[]): Promise<void> {}
  async invalidate(_key: string): Promise<void> {}
}

// Minimal Redis surface (ioredis-compatible) so we depend on an interface, not
// a concrete client. The app injects a real client when REDIS_URL is set.
export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export class RedisFlagCache implements FlagCacheI {
  private ttlMs: number;

  constructor(
    private client: RedisClientLike,
    private prefix = "flags:",
    opts?: { ttlMs?: number },
  ) {
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  }

  private redisKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get(key: string): Promise<Flag[] | null> {
    const raw = await this.client.get(this.redisKey(key));
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw, reviveFlag) as Flag[];
    } catch {
      // Corrupt/legacy payload — treat as a miss so callers refresh from Mongo.
      return null;
    }
  }

  async set(key: string, flags: Flag[]): Promise<void> {
    await this.client.set(
      this.redisKey(key),
      JSON.stringify(flags),
      "PX",
      this.ttlMs,
    );
  }

  async invalidate(key: string): Promise<void> {
    await this.client.del(this.redisKey(key));
  }
}

// ObjectId and Date serialize to strings in JSON; the evaluator only reads
// `key` / `environments`, so we keep values as-is and just parse the envelope.
function reviveFlag(_key: string, value: unknown): unknown {
  return value;
}
