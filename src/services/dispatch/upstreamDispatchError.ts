/**
 * A dispatch target answered with a non-OK status.
 *
 * The upstream response body is deliberately kept OUT of `message`. Route
 * handlers surface `error.message` to the caller, and for the `raw` and
 * `jenkins` providers the upstream URL is chosen by the customer — so echoing
 * the body back turns a deploy trigger into a way to read any HTTP response
 * GitLaunch's network can reach.
 *
 * The body stays on `responseBody` so `log.error({ err })` still records it for
 * diagnosis. Never put this object in a response.
 */
export class UpstreamDispatchError extends Error {
  constructor(
    summary: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`${summary}: upstream responded ${status}`);
    this.name = "UpstreamDispatchError";
  }
}
