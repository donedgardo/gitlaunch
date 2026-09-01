import { PutObjectCommand } from "@aws-sdk/client-s3";
import { BundlePublisherI } from "./bundlePublisher";
import { S3LikeClient } from "./r2BundlePublisher";
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

// Records every PutObjectCommand sent to it, so R2BundlePublisher can be
// tested against the S3-compatible wire contract without hitting real R2.
export class FakeS3Client implements S3LikeClient {
  puts: PutObjectCommand[] = [];

  async send(command: PutObjectCommand): Promise<unknown> {
    this.puts.push(command);
    return {};
  }
}
