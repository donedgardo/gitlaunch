import {
  FlagCacheI,
  InMemoryFlagCache,
  RedisFlagCache,
  RedisClientLike,
} from "./flagCache";

// Build the flag-evaluation cache from the environment. When REDIS_URL is set
// we use a shared Redis cache (so invalidations propagate across instances);
// otherwise a per-instance in-memory cache. ioredis is loaded optionally — it
// is only required if you actually opt into Redis — so it stays out of the
// default dependency footprint.
export function createFlagCache(
  env: NodeJS.ProcessEnv = process.env,
): FlagCacheI {
  const url = env.REDIS_URL;
  if (!url) {
    return new InMemoryFlagCache();
  }

  try {
    // eval("require") hides the specifier from the type-checker/bundler so an
    // uninstalled ioredis doesn't break the build; it throws at runtime only
    // when Redis is actually requested, and we fall back gracefully below.
    const optionalRequire = eval("require") as NodeRequire;
    const Redis = optionalRequire("ioredis");
    const client = new Redis(url) as unknown as RedisClientLike;
    return new RedisFlagCache(client);
  } catch (err) {
    console.warn(
      "[flags] REDIS_URL is set but ioredis could not be loaded; " +
        "falling back to in-memory flag cache. Run `yarn add ioredis` to enable Redis.",
      err,
    );
    return new InMemoryFlagCache();
  }
}
