import { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";

export type RateLimitConfig = {
  max: number;
  timeWindowMs: number;
};

// A global default (keyed by request.ip) so every route gets some protection
// against brute-force and cost abuse even before it opts into anything.
// Individual routes can still ask for a stricter limit via
// `{ config: { rateLimit: { max, timeWindow } } }` on the route itself.
export function registerRateLimit(
  server: FastifyInstance,
  config: RateLimitConfig,
): void {
  server.register(rateLimit, {
    max: config.max,
    timeWindow: config.timeWindowMs,
  });
}
