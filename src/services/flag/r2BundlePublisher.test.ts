import { describe, it, expect } from "vitest";
import { R2BundlePublisher } from "./r2BundlePublisher";
import { FakeS3Client } from "./fakes";
import { FlagConfigBundle } from "./configBundle";

describe("R2BundlePublisher", () => {
  const bundle: FlagConfigBundle = {
    environment: "prod",
    flags: [
      {
        key: "new-checkout",
        config: { enabled: true, rolloutPercentage: 100, variants: [] },
      },
    ],
  };

  it("should PUT the bundle JSON to a key scoped by slug and environment", async () => {
    const client = new FakeS3Client();
    const publisher = new R2BundlePublisher(client, "gitlaunch-flags-prod");

    await publisher.publish("abc123", "prod", bundle);

    expect(client.puts).toHaveLength(1);
    const put = client.puts[0].input;
    expect(put.Bucket).toBe("gitlaunch-flags-prod");
    expect(put.Key).toBe("flags/abc123/prod.json");
    expect(JSON.parse(put.Body as string)).toEqual(bundle);
    expect(put.ContentType).toBe("application/json");
  });

  it("should set a cache-control matching the agreed staleness budget", async () => {
    const client = new FakeS3Client();
    const publisher = new R2BundlePublisher(client, "gitlaunch-flags-prod");

    await publisher.publish("abc123", "prod", bundle);

    expect(client.puts[0].input.CacheControl).toBe(
      "public, max-age=30, must-revalidate",
    );
  });

  it("should scope different environments of the same service to different keys", async () => {
    const client = new FakeS3Client();
    const publisher = new R2BundlePublisher(client, "gitlaunch-flags-prod");

    await publisher.publish("abc123", "prod", bundle);
    await publisher.publish("abc123", "staging", bundle);

    expect(client.puts.map((p) => p.input.Key)).toEqual([
      "flags/abc123/prod.json",
      "flags/abc123/staging.json",
    ]);
  });
});
