import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { BundlePublisherI } from "./bundlePublisher";
import { FlagConfigBundle } from "./configBundle";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

// Minimal shape of the S3 client this needs, so tests can inject a fake
// (FakeS3Client) instead of hitting real R2 or mocking the AWS SDK.
export interface S3LikeClient {
  send(command: PutObjectCommand): Promise<unknown>;
}

// Publishes flag config bundles to Cloudflare R2 (S3-compatible, zero egress
// fees) so a browser SDK can fetch them directly instead of asking our
// server to evaluate on every request. CacheControl's max-age is the agreed
// worst-case propagation delay for a flag change reaching that path — no
// worse than the SDK's existing in-memory decision cache.
export class R2BundlePublisher implements BundlePublisherI {
  constructor(
    private client: S3LikeClient,
    private bucket: string,
  ) {}

  static forAccount(config: R2Config): R2BundlePublisher {
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    return new R2BundlePublisher(client, config.bucket);
  }

  async publish(
    slug: string,
    envName: string,
    bundle: FlagConfigBundle,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: `flags/${slug}/${envName}.json`,
        Body: JSON.stringify(bundle),
        ContentType: "application/json",
        CacheControl: "public, max-age=30, must-revalidate",
      }),
    );
  }
}
