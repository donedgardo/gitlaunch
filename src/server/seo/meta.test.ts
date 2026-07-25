import { describe, it, expect } from "vitest";
import { buildPageMeta } from "./meta";

describe("buildPageMeta", () => {
  const publicUrl = "https://gitlaunch.io";

  it("should use the given title and description for sharing", () => {
    // Given a page describes itself
    const meta = buildPageMeta({
      title: "Deploy with confidence",
      description: "Trigger and track deployments from one dashboard.",
      path: "/",
      publicUrl,
    });

    // Then the sharing tags carry that copy
    expect(meta.ogTitle).toBe("Deploy with confidence");
    expect(meta.ogDescription).toBe(
      "Trigger and track deployments from one dashboard.",
    );
    expect(meta.description).toBe(
      "Trigger and track deployments from one dashboard.",
    );
    // Twitter mirrors OpenGraph so both networks unfurl the same card
    expect(meta.twitterTitle).toBe("Deploy with confidence");
    expect(meta.twitterDescription).toBe(
      "Trigger and track deployments from one dashboard.",
    );
  });

  it("should fall back to site defaults when a page says nothing", () => {
    // Given a page provides no copy of its own
    const meta = buildPageMeta({ path: "/", publicUrl });

    // Then it still gets a sensible, branded card
    expect(meta.ogTitle).toContain("GitLaunch");
    expect(meta.description.length).toBeGreaterThan(0);
    expect(meta.ogDescription).toBe(meta.description);
    expect(meta.ogSiteName).toBe("GitLaunch");
    expect(meta.ogType).toBe("website");
    expect(meta.twitterCard).toBe("summary_large_image");
  });

  it("should turn a page path into an absolute canonical and og:url", () => {
    // Given a page at a specific path
    const meta = buildPageMeta({ path: "/invite/abc123", publicUrl });

    // Then the canonical and og:url are absolute against the public origin
    expect(meta.canonical).toBe("https://gitlaunch.io/invite/abc123");
    expect(meta.ogUrl).toBe("https://gitlaunch.io/invite/abc123");
  });

  it("should not produce a double slash when the public url has a trailing slash", () => {
    // Given a misconfigured base url with a trailing slash
    const meta = buildPageMeta({
      path: "/dashboard",
      publicUrl: "https://gitlaunch.io/",
    });

    // Then joining stays clean
    expect(meta.canonical).toBe("https://gitlaunch.io/dashboard");
  });

  it("should resolve a relative image path to an absolute og:image", () => {
    // Given a relative social image
    const meta = buildPageMeta({
      path: "/",
      image: "/public/og-image.png",
      publicUrl,
    });

    // Then it becomes absolute so crawlers can fetch it
    expect(meta.ogImage).toBe("https://gitlaunch.io/public/og-image.png");
    expect(meta.twitterImage).toBe("https://gitlaunch.io/public/og-image.png");
  });

  it("should default to the shared social image when none is given", () => {
    // Given no image override
    const meta = buildPageMeta({ path: "/", publicUrl });

    // Then the default branded card is used
    expect(meta.ogImage).toBe("https://gitlaunch.io/public/og-image.png");
  });

  it("should leave an already-absolute image untouched", () => {
    // Given an image hosted elsewhere
    const meta = buildPageMeta({
      path: "/",
      image: "https://cdn.example.com/card.png",
      publicUrl,
    });

    // Then it is used as-is
    expect(meta.ogImage).toBe("https://cdn.example.com/card.png");
  });

  it("should let a page be indexed by default", () => {
    // Given a public page with no robots preference
    const meta = buildPageMeta({ path: "/", publicUrl });

    // Then search engines are welcome
    expect(meta.robots).toBe("index, follow");
  });

  it("should keep a private page out of search results when asked", () => {
    // Given a page behind a secret token (e.g. an invite link)
    const meta = buildPageMeta({
      path: "/invite/secret-token",
      robots: "noindex, nofollow",
      publicUrl,
    });

    // Then it still unfurls when shared, but is never indexed
    expect(meta.robots).toBe("noindex, nofollow");
    expect(meta.ogTitle).toBeTruthy();
  });

  it("should still yield usable relative urls when no public url is configured", () => {
    // Given PUBLIC_URL is unset (e.g. local dev without config)
    const meta = buildPageMeta({ path: "/pricing", publicUrl: "" });

    // Then it degrades to the path rather than crashing
    expect(meta.canonical).toBe("/pricing");
    expect(meta.ogImage).toBe("/public/og-image.png");
  });
});
