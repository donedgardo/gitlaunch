import { describe, it, expect } from "vitest";
import { formatTimeAgo } from "./timeAgo";

describe("formatTimeAgo", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");

  it("should say 'just now' for a report seconds old", () => {
    const from = new Date("2026-07-24T11:59:30.000Z");
    expect(formatTimeAgo(from, now)).toBe("just now");
  });

  it("should report whole minutes", () => {
    const from = new Date("2026-07-24T11:42:00.000Z");
    expect(formatTimeAgo(from, now)).toBe("18m ago");
  });

  it("should report whole hours", () => {
    const from = new Date("2026-07-24T10:00:00.000Z");
    expect(formatTimeAgo(from, now)).toBe("2h ago");
  });

  it("should report whole days", () => {
    const from = new Date("2026-07-21T12:00:00.000Z");
    expect(formatTimeAgo(from, now)).toBe("3d ago");
  });

  it("should report months once past ~30 days", () => {
    const from = new Date("2026-05-24T12:00:00.000Z");
    expect(formatTimeAgo(from, now)).toBe("2mo ago");
  });

  it("should report years for very old builds", () => {
    const from = new Date("2024-07-24T12:00:00.000Z");
    expect(formatTimeAgo(from, now)).toBe("2y ago");
  });

  it("should treat a future timestamp as 'just now' rather than negative", () => {
    const from = new Date("2026-07-24T12:05:00.000Z");
    expect(formatTimeAgo(from, now)).toBe("just now");
  });

  it("should return an empty string when there is no timestamp", () => {
    expect(formatTimeAgo(undefined, now)).toBe("");
  });
});
