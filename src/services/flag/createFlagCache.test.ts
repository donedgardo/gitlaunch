import { describe, it, expect } from "vitest";
import { createFlagCache } from "./createFlagCache";
import { InMemoryFlagCache } from "./flagCache";

describe("createFlagCache", () => {
  it("should return an in-memory cache when REDIS_URL is not set", () => {
    const cache = createFlagCache({} as NodeJS.ProcessEnv);
    expect(cache).toBeInstanceOf(InMemoryFlagCache);
  });

  it("should fall back to in-memory when ioredis is unavailable", () => {
    // ioredis is not a dependency, so a REDIS_URL must degrade gracefully.
    const cache = createFlagCache({
      REDIS_URL: "redis://localhost:6379",
    } as NodeJS.ProcessEnv);
    expect(cache).toBeInstanceOf(InMemoryFlagCache);
  });
});
