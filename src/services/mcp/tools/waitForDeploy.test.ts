import { describe, it, expect } from "vitest";
import { waitForDeployTool } from "./waitForDeploy";
import { BuildHistory } from "./support";
import { FakeWorkspace, aBuild, aCaller, aService } from "../fakes";
import { DeploymentStatus } from "../../service/deploymentStatus";
import { Build } from "../../../repositories/buildRepository";
import { Service } from "../../../repositories/serviceRepository";

const at = (iso: string) => new Date(iso);

// v1 is live in staging; v2 is at `status` there.
const v2At = (service: Service, status: DeploymentStatus): Build[] => [
  aBuild(service, "v1", {
    createdAt: at("2026-11-01T00:00:00Z"),
    message: "Stable release",
    logs:
      status === DeploymentStatus.DEPLOYED
        ? []
        : [
            {
              environment: "staging",
              status: DeploymentStatus.DEPLOYED,
              at: at("2026-11-01T01:00:00Z"),
            },
          ],
  }),
  aBuild(service, "v2", {
    createdAt: at("2026-11-02T00:00:00Z"),
    message: "Checkout rewrite",
    logs: [{ environment: "staging", status, at: at("2026-11-02T01:00:00Z") }],
  }),
];

// What the pipeline does while we wait: each read of the history sees the
// next state, and the last state holds from then on.
const unfolding = (states: Build[][]): BuildHistory & { reads: number } => {
  const history = {
    reads: 0,
    getBuilds: async () => {
      const state = states[Math.min(history.reads, states.length - 1)];
      history.reads += 1;
      return state;
    },
  };
  return history;
};

// Records how long the tool asked to pause, without pausing.
const pauses = () => {
  const asked: number[] = [];
  return { asked, pause: async (ms: number) => void asked.push(ms) };
};

describe("wait_for_deploy", () => {
  it("should need only permission to read builds, and change nothing", () => {
    const tool = waitForDeployTool(new FakeWorkspace(), new FakeWorkspace());

    expect(tool.name).toBe("wait_for_deploy");
    expect(tool.requiredScope).toBe("builds:read");
    expect(tool.changes).toBe(false);
  });

  it("should answer at once when nothing is in flight", async () => {
    const service = aService();
    const history = unfolding([v2At(service, DeploymentStatus.DEPLOYED)]);
    const { asked, pause } = pauses();

    const result = await waitForDeployTool(
      new FakeWorkspace([service]),
      history,
      pause,
    ).run(aCaller(["builds:read"]), {
      serviceId: service._id.toString(),
      environment: "staging",
    });

    expect(asked).toEqual([]);
    expect(result).toEqual({
      environment: "staging",
      settled: true,
      waitedSeconds: 0,
      outcome: null,
      live: { buildId: "v2", message: "Checkout rewrite" },
    });
  });

  it("should wait until the deploy in flight lands, and say how it ended", async () => {
    const service = aService();
    const history = unfolding([
      v2At(service, DeploymentStatus.DISPATCHING),
      v2At(service, DeploymentStatus.DEPLOYING),
      v2At(service, DeploymentStatus.DEPLOYED),
    ]);
    const { asked, pause } = pauses();

    const result = await waitForDeployTool(
      new FakeWorkspace([service]),
      history,
      pause,
    ).run(aCaller(["builds:read"]), {
      serviceId: service._id.toString(),
      environment: "staging",
    });

    expect(asked).toEqual([1000, 1000]);
    expect(result).toEqual({
      environment: "staging",
      settled: true,
      waitedSeconds: 2,
      outcome: { buildId: "v2", status: "deployed" },
      live: { buildId: "v2", message: "Checkout rewrite" },
    });
  });

  it("should report a deploy that failed, with the build still live", async () => {
    const service = aService();
    const history = unfolding([
      v2At(service, DeploymentStatus.DEPLOYING),
      v2At(service, DeploymentStatus.ERROR),
    ]);

    const result = await waitForDeployTool(
      new FakeWorkspace([service]),
      history,
      pauses().pause,
    ).run(aCaller(["builds:read"]), {
      serviceId: service._id.toString(),
      environment: "staging",
    });

    expect(result).toMatchObject({
      settled: true,
      outcome: { buildId: "v2", status: "error" },
      live: { buildId: "v1" },
    });
  });

  it("should give up after the time allowed and say the deploy is still in flight", async () => {
    const service = aService();
    const history = unfolding([v2At(service, DeploymentStatus.DEPLOYING)]);
    const { asked, pause } = pauses();

    const result = await waitForDeployTool(
      new FakeWorkspace([service]),
      history,
      pause,
    ).run(aCaller(["builds:read"]), {
      serviceId: service._id.toString(),
      environment: "staging",
      timeoutSeconds: 3,
    });

    expect(asked).toEqual([1000, 1000, 1000]);
    expect(result).toMatchObject({
      environment: "staging",
      settled: false,
      waitedSeconds: 3,
      inFlight: { buildId: "v2", status: "deploying" },
    });
    expect((result as { next: string }).next).toMatch(/wait_for_deploy again/);
  });

  it("should not watch another environment's deploy", async () => {
    const service = aService();
    const history = unfolding([v2At(service, DeploymentStatus.DEPLOYING)]);
    const { asked, pause } = pauses();

    const result = await waitForDeployTool(
      new FakeWorkspace([service]),
      history,
      pause,
    ).run(aCaller(["builds:read"]), {
      serviceId: service._id.toString(),
      environment: "prod",
    });

    expect(asked).toEqual([]);
    expect(result).toMatchObject({ settled: true, outcome: null, live: null });
  });

  it("should refuse an environment the service does not have", async () => {
    const service = aService();

    await expect(
      waitForDeployTool(
        new FakeWorkspace([service]),
        unfolding([[]]),
        pauses().pause,
      ).run(aCaller(["builds:read"]), {
        serviceId: service._id.toString(),
        environment: "production",
      }),
    ).rejects.toThrow(/Unknown environment "production"/);
  });
});
