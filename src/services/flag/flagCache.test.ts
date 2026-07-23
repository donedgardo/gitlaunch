import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  InMemoryFlagCache,
  NoOpFlagCache,
  RedisFlagCache,
  RedisClientLike,
} from "./flagCache";
import type { Flag } from "../../repositories/flagRepository";

function makeFlag(key: string): Flag {
  return {
    _id: new ObjectId(),
    accountId: new ObjectId(),
    serviceId: new ObjectId(),
    key,
    description: "",
    environments: {
      prod: { enabled: true, rolloutPercentage: 100, variants: [] },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("InMemoryFlagCache", () => {
  it("should return null on a miss and the stored value on a hit", async () => {
    const cache = new InMemoryFlagCache();
    expect(await cache.get("a:b")).toBeNull();

    const flags = [makeFlag("x")];
    await cache.set("a:b", flags);

    expect(await cache.get("a:b")).toEqual(flags);
  });

  it("should return null after the entry is invalidated", async () => {
    const cache = new InMemoryFlagCache();
    await cache.set("a:b", [makeFlag("x")]);

    await cache.invalidate("a:b");

    expect(await cache.get("a:b")).toBeNull();
  });

  it("should expire entries after the TTL elapses", async () => {
    let clock = 1000;
    const cache = new InMemoryFlagCache({ ttlMs: 500, now: () => clock });
    await cache.set("a:b", [makeFlag("x")]);

    clock = 1400; // within TTL
    expect(await cache.get("a:b")).not.toBeNull();

    clock = 1600; // past TTL
    expect(await cache.get("a:b")).toBeNull();
  });
});

describe("NoOpFlagCache", () => {
  it("should always miss", async () => {
    const cache = new NoOpFlagCache();
    await cache.set("a:b", [makeFlag("x")]);
    expect(await cache.get("a:b")).toBeNull();
  });
});

describe("RedisFlagCache", () => {
  function fakeRedis() {
    const store = new Map<string, string>();
    const client: RedisClientLike = {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => {
        store.set(k, v);
        return "OK";
      },
      del: async (k) => {
        store.delete(k);
        return 1;
      },
    };
    return { client, store };
  }

  it("should round-trip flags through the client with a prefixed key", async () => {
    const { client, store } = fakeRedis();
    const cache = new RedisFlagCache(client);
    const flags = [makeFlag("x")];

    await cache.set("a:b", flags);

    expect([...store.keys()]).toEqual(["flags:a:b"]);
    const read = await cache.get("a:b");
    expect(read?.[0].key).toBe("x");
  });

  it("should return null on a miss", async () => {
    const { client } = fakeRedis();
    const cache = new RedisFlagCache(client);
    expect(await cache.get("missing")).toBeNull();
  });

  it("should delete the key on invalidate", async () => {
    const { client, store } = fakeRedis();
    const cache = new RedisFlagCache(client);
    await cache.set("a:b", [makeFlag("x")]);

    await cache.invalidate("a:b");

    expect(store.size).toBe(0);
  });
});
