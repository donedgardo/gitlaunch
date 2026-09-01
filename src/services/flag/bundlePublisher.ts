import { FlagConfigBundle } from "./configBundle";

// Publishes a service+environment's current flag config bundle somewhere a
// browser SDK can fetch it directly (e.g. object storage behind a CDN),
// bypassing our own server on every evaluation. Narrow on purpose: no
// delete/list — callers only ever want "current" to be servable, and slug
// rotation (see ServiceRepository) already handles making an old bundle
// unreachable without needing active cleanup.
export interface BundlePublisherI {
  publish(
    slug: string,
    envName: string,
    bundle: FlagConfigBundle,
  ): Promise<void>;
}

// Open-core default when no object-storage backend is configured (e.g. R2
// env vars unset). A missed publish isn't an outage: the browser SDK's
// bundle fetch simply finds nothing and falls back to the existing HTTP
// evaluate endpoint.
export class NoopBundlePublisher implements BundlePublisherI {
  async publish(): Promise<void> {}
}
