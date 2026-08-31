import { BundlePublisherI } from "./bundlePublisher";
import { FlagConfigBundle } from "./configBundle";

type PublishCall = {
  slug: string;
  envName: string;
  bundle: FlagConfigBundle;
};

// Records every publish call in-memory so a test can assert on observable
// state (was this slug/env published, with what bundle, how many times)
// instead of asserting on mock call arguments.
export class FakeBundlePublisher implements BundlePublisherI {
  calls: PublishCall[] = [];

  async publish(
    slug: string,
    envName: string,
    bundle: FlagConfigBundle,
  ): Promise<void> {
    this.calls.push({ slug, envName, bundle });
  }

  latestFor(slug: string, envName: string): PublishCall | null {
    const matches = this.calls.filter(
      (c) => c.slug === slug && c.envName === envName,
    );
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }
}

// A publisher that always fails, for verifying that a broken object-storage
// backend never breaks the version write it rides along with.
export class FailingBundlePublisher implements BundlePublisherI {
  async publish(): Promise<void> {
    throw new Error("bundle publish failed");
  }
}
