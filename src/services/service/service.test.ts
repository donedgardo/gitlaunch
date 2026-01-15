import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { Service } from "./index";
import { BuildMockStorage } from "../buildStorage/buildMockStorage";
import { DeploymentStatus } from "./deploymentStatus";
import { MockEventEmitter, testEnvironments } from "../../server/test.helpers";
import { BuildUpdateEvent } from "./buildUpdateEvent";
import { MockDispatchService } from "./mockDispatchService";

describe("Service", () => {
  let service: Service;
  let serviceName = "MockService";
  let eventEmitter: MockEventEmitter;
  let mockDispatchService: MockDispatchService;
  const buildId = "hash";
  beforeEach(async () => {
    vi.useFakeTimers();
    const date = new Date(2024, 1, 1);
    vi.setSystemTime(date);
    const storage = new BuildMockStorage();
    eventEmitter = new MockEventEmitter();
    mockDispatchService = new MockDispatchService();
    service = new Service(
      serviceName,
      storage,
      eventEmitter,
      mockDispatchService,
      testEnvironments,
    );
    await service.create(buildId);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("gets a list of builds", async () => {
    const builds = await service.getBuilds();
    expect(builds[0].id).toEqual(buildId);
    expect(builds[0].deployments).toEqual({});
  });
  describe("creating a build", () => {
    const newBuild = { id: "hash2" };
    beforeEach(async () => {
      vi.setSystemTime(new Date(2024, 1, 2));
      await service.create(newBuild.id);
    });
    it("adds to the list", async () => {
      const builds = await service.getBuilds();
      expect(builds.length).toEqual(2);
    });
    it("returns in the order of creation", async () => {
      const builds = await service.getBuilds();
      expect(builds[0].id).toEqual(newBuild.id);
    });
  });
  it("can find by id", async () => {
    const build = await service.findOne(buildId);
    expect(build?.id).toEqual(buildId);
    expect(build?.deployments).toEqual({});
    expect(build?.deploymentLogs).toEqual([]);
    expect(build?.created_at).toEqual(new Date(2024, 1, 1));
  });
  it("can get service name", () => {
    const name = service.getName();
    expect(name).toBe(serviceName);
  });
  it("fails creating a deployment log with invalid environment", async () => {
    try {
      await expect(
        service.updateDeploymentStatus(
          buildId,
          "invalid",
          DeploymentStatus.DEPLOYING,
        ),
      ).rejects.toThrowError();
    } catch (e: any) {
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toContain("Invalid environment");
    }
  });
  describe("dispatching build", () => {
    it("should call dispatching service", async () => {
      await service.updateDeploymentStatus(
        buildId,
        testEnvironments[0],
        DeploymentStatus.DISPATCHING,
      );
      expect(mockDispatchService.toHaveBeenCalled()).toBeTruthy();
    });
  });
  describe("deploying build", () => {
    let wasCalled: boolean;
    let updatedBuilds: BuildUpdateEvent[];
    let callback;
    beforeEach(async () => {
      wasCalled = false;
      updatedBuilds = [];
      callback = (builds: BuildUpdateEvent[]) => {
        wasCalled = true;
        updatedBuilds = builds;
      };
      eventEmitter.on("build:update", callback);
      await service.updateDeploymentStatus(
        buildId,
        testEnvironments[0],
        DeploymentStatus.DEPLOYED,
      );
    });
    it("should update deployment status", async () => {
      const deploymentStatus = await service.getDeploymentStatus(buildId);
      expect(deploymentStatus[testEnvironments[0]]).toEqual(
        DeploymentStatus.DEPLOYED,
      );
    });
    it("emits event about the new updated build", () => {
      expect(wasCalled).toBeTruthy();
    });
    it("emits event data of the updated build event properties", () => {
      const updatedBuild = updatedBuilds[0];
      expect(updatedBuild.buildId).toEqual(buildId);
      expect(updatedBuild.serviceName).toEqual(serviceName);
      expect(updatedBuild.environment).toEqual(testEnvironments[0]);
      expect(updatedBuild.status).toEqual(DeploymentStatus.DEPLOYED);
    });
    it("should get deployment logs", async () => {
      const deploymentLogs = await service.getDeploymentsLogs(buildId);
      expect(deploymentLogs).toEqual([
        {
          environment: testEnvironments[0],
          status: DeploymentStatus.DEPLOYED,
        },
      ]);
    });
    it("should not call the dispatching service", async () => {
      expect(mockDispatchService.toHaveBeenCalled()).toBeFalsy();
    });
    describe("dispatching another build ", () => {
      const otherBuildId = "hash3";
      beforeEach(async () => {
        await service.create(otherBuildId);
        await service.updateDeploymentStatus(
          otherBuildId,
          testEnvironments[0],
          DeploymentStatus.DISPATCHING,
        );
      });
      it("won't change other builds in the same env", async () => {
        const buildDeployments = await service.getDeploymentStatus(buildId);
        expect(buildDeployments[testEnvironments[0]]).toEqual(
          DeploymentStatus.DEPLOYED,
        );
      });
      describe("creating the same build", () => {
        it("should not override status", async () => {
          const build = await service.create(buildId);
          expect(build.deployments[testEnvironments[0]]).toEqual(
            DeploymentStatus.DEPLOYED,
          );
        });
      });
    });
    describe("deployed another build to same env", () => {
      const otherBuildId = "hash2";
      beforeEach(async () => {
        await service.create(otherBuildId);
        await service.updateDeploymentStatus(
          otherBuildId,
          testEnvironments[0],
          DeploymentStatus.DEPLOYED,
        );
      });
      it("removes deployment of previously deployed build", async () => {
        const buildDeployments = await service.getDeploymentStatus(buildId);
        expect(buildDeployments[testEnvironments[0]]).toEqual(
          DeploymentStatus.NONE,
        );
      });
      it("emits event data of both updated builds", () => {
        expect(updatedBuilds).toHaveLength(2);
      });
      it("first event is updated build", () => {
        const updatedBuild = updatedBuilds[0];
        expect(updatedBuild.buildId).toEqual(otherBuildId);
        expect(updatedBuild.environment).toEqual(testEnvironments[0]);
        expect(updatedBuild.serviceName).toEqual(serviceName);
        expect(updatedBuild.status).toEqual(DeploymentStatus.DEPLOYED);
      });
      it("last event is outdated build already updated to none", () => {
        const updatedBuild = updatedBuilds[1];
        expect(updatedBuild.buildId).toEqual(buildId);
        expect(updatedBuild.environment).toEqual(testEnvironments[0]);
        expect(updatedBuild.serviceName).toEqual(serviceName);
        expect(updatedBuild.status).toEqual(DeploymentStatus.NONE);
      });
    });
    describe("updating a build status to error then updating deployed another build", () => {
      const otherBuildId = "hash4";
      beforeEach(async () => {
        await service.create(otherBuildId);
        await service.updateDeploymentStatus(
          otherBuildId,
          testEnvironments[0],
          DeploymentStatus.ERROR,
        );
        await service.updateDeploymentStatus(
          buildId,
          testEnvironments[0],
          DeploymentStatus.DEPLOYED,
        );
      });
      it("should not update error status of build same env", async () => {
        const buildDeployments =
          await service.getDeploymentStatus(otherBuildId);
        expect(buildDeployments[testEnvironments[0]]).toEqual(
          DeploymentStatus.ERROR,
        );
      });
    });
  });
});
