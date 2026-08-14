import { FastifyInstance, FastifyError, FastifyReply } from "fastify";

/**
 * Keeps unexpected failures from describing themselves to the caller.
 *
 * Fastify's default error handler replies with `error.message`. That is fine
 * for the 4xx we raise on purpose, but for anything unplanned the message is
 * written for us, not for the customer: Mongo duplicate-key errors quote the
 * conflicting value, upstream clients quote response bodies, and a stray
 * TypeError names our internals.
 *
 * 4xx keeps its message — those are answers to a bad request. 5xx becomes a
 * flat "Internal Server Error", with the real error logged.
 */
export function registerErrorSanitizer(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply: FastifyReply) => {
    const status = error.statusCode ?? reply.statusCode ?? 500;

    if (status >= 400 && status < 500) {
      return reply.status(status).send({ error: error.message });
    }

    request.log.error(
      { err: error, url: request.url, method: request.method },
      "Unhandled error while handling request",
    );

    return reply.status(status >= 500 ? status : 500).send({
      error: "Internal Server Error",
    });
  });
}
