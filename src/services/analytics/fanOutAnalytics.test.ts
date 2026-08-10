import { describe, it, expect } from "vitest";
import { FanOutAnalytics } from "./fanOutAnalytics";
import { RecordingAnalytics } from "./fakes";

describe("FanOutAnalytics", () => {
  it("should deliver a tracked event to every sink", () => {
    // Given two sinks behind one analytics service
    const warehouse = new RecordingAnalytics();
    const product = new RecordingAnalytics();
    const analytics = new FanOutAnalytics([warehouse, product]);

    // When an event is tracked
    analytics.track(
      "service_created",
      { provider: "github" },
      { accountId: "a1" },
    );

    // Then both sinks receive it, unchanged
    expect(warehouse.tracked).toEqual(product.tracked);
    expect(warehouse.tracked[0].event).toBe("service_created");
    expect(warehouse.tracked[0].properties).toEqual({ provider: "github" });
    expect(warehouse.tracked[0].context).toEqual({ accountId: "a1" });
  });

  it("should deliver identify and navigation to every sink", () => {
    // Given two sinks behind one analytics service
    const warehouse = new RecordingAnalytics();
    const product = new RecordingAnalytics();
    const analytics = new FanOutAnalytics([warehouse, product]);

    // When the other kinds of signal are emitted
    analytics.identify("u1", { email: "sam@example.com" });
    analytics.navigation("plan_selection");

    // Then both sinks see them
    expect(warehouse.identifies).toHaveLength(1);
    expect(product.identifies[0].userId).toBe("u1");
    expect(warehouse.navigations[0].destination).toBe("plan_selection");
    expect(product.navigations[0].destination).toBe("plan_selection");
  });

  it("should keep delivering to healthy sinks when one fails", () => {
    // Given one broken sink ahead of a healthy one
    const broken = new RecordingAnalytics();
    broken.failWith = new Error("warehouse unreachable");
    const healthy = new RecordingAnalytics();
    const errors: unknown[] = [];
    const analytics = new FanOutAnalytics([broken, healthy], (e) =>
      errors.push(e),
    );

    // When an event is tracked
    analytics.track("service_created");

    // Then the failure is isolated: the other sink still got the event
    expect(healthy.tracked).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("should not break the caller when a sink throws", () => {
    // Given a single broken sink
    const broken = new RecordingAnalytics();
    broken.failWith = new Error("nope");
    const analytics = new FanOutAnalytics([broken], () => {});

    // When events are emitted
    // Then the request path is unaffected
    expect(() => analytics.track("service_created")).not.toThrow();
    expect(() => analytics.identify("u1", {})).not.toThrow();
    expect(() => analytics.navigation("plan_selection")).not.toThrow();
  });

  it("should drain every sink that can be drained when flushed", async () => {
    // Given sinks where only one buffers its writes
    const plain = new RecordingAnalytics();
    const buffering = new RecordingAnalytics() as RecordingAnalytics & {
      drained?: boolean;
      flush(): Promise<void>;
    };
    buffering.flush = async () => {
      buffering.drained = true;
    };
    const analytics = new FanOutAnalytics([plain, buffering]);

    // When the composite is flushed
    await analytics.flush();

    // Then the buffering sink was drained, and the plain one did not break it
    expect(buffering.drained).toBe(true);
  });
});
