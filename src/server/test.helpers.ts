import { MockAuthService } from "../services/auth/mockAuthService";
import { BuildMockStorage } from "../services/buildStorage/buildMockStorage";
import { Service } from "../services/service";
import createServer from "./index";
import { Environments } from "../services/buildStorage/environments";
import EventEmitter from "node:events";
import { MockDbClient } from "./auth/mockDbClient";
import { MockDispatchService } from "../services/service/mockDispatchService";

export const testEnvironments = [Environments.STAGING, Environments.PROD];

export const mockBuildId = "hash";
export class MockEventEmitter extends EventEmitter {}
const mockEventEmitter = new MockEventEmitter();
const mockStorage = new BuildMockStorage([mockBuildId]);

export const mockDispatchService = new MockDispatchService();
export const mockBackendService = new Service(
  "service-a",
  mockStorage,
  mockEventEmitter,
  mockDispatchService,
  testEnvironments,
);
export const mockFrontendService = new Service(
  "service-b",
  mockStorage,
  mockEventEmitter,
  mockDispatchService,
  testEnvironments,
);
export const mockAuthService = new MockAuthService();

export function createMockServer() {
  const mockDbClient = new MockDbClient();
  return createServer(
    mockAuthService,
    mockEventEmitter,
    [mockBackendService, mockFrontendService],
    mockDbClient,
  );
}
