import { ObjectId } from "mongodb";
import { McpCaller } from "./tool";
import { Build } from "../../repositories/buildRepository";
import { Service } from "../../repositories/serviceRepository";
import { ApiKeyScope } from "../../repositories/apiKeyRepository";
import { Actor } from "../service/actor";
import { DeploymentStatus } from "../service/deploymentStatus";

/**
 * Test doubles for MCP tools. A tool depends only on narrow ports, so each of
 * these is a few plain objects in memory rather than a mock of a repository.
 */

export const ACCOUNT_ID = new ObjectId();

export function aCaller(
  scopes: ApiKeyScope[],
  overrides: Partial<McpCaller> = {},
): McpCaller {
  return {
    accountId: ACCOUNT_ID,
    apiKeyId: new ObjectId(),
    name: "staging-agent",
    scopes,
    ...overrides,
  };
}

export function aService(overrides: Partial<Service> = {}): Service {
  return {
    _id: new ObjectId(),
    accountId: ACCOUNT_ID,
    name: "web-app",
    environments: [
      { name: "staging", order: 0 },
      { name: "prod", order: 1 },
    ],
    deployment: null,
    ...overrides,
  } as Service;
}

export const maria: Actor = {
  kind: "user",
  userId: new ObjectId(),
  name: "Maria",
  via: "dashboard",
};

export const ciKey: Actor = {
  kind: "apiKey",
  apiKeyId: new ObjectId(),
  name: "ci-pipeline",
  via: "api",
};

type LogInput = {
  environment: string;
  status: DeploymentStatus;
  at: Date;
  actor?: Actor;
  reason?: string;
  intent?: "promote" | "rollback";
};

// A build as the repository would return it. `logs` become its deployment
// history, and the current status per environment is the last one logged.
export function aBuild(
  service: Service,
  buildId: string,
  options: {
    message?: string;
    createdAt?: Date;
    logs?: LogInput[];
  } = {},
): Build {
  const logs = options.logs ?? [];
  const deployments: Record<string, DeploymentStatus> = {};
  const deployedAt: Record<string, Date> = {};
  for (const log of logs) {
    deployments[log.environment] = log.status;
    if (log.status === DeploymentStatus.DEPLOYED) {
      deployedAt[log.environment] = log.at;
    }
  }
  const createdAt = options.createdAt ?? new Date("2026-11-01T00:00:00Z");
  return {
    _id: new ObjectId(),
    accountId: service.accountId,
    serviceId: service._id,
    buildId,
    message: options.message,
    deployments,
    deployedAt,
    deploymentLogs: logs,
    createdAt,
    updatedAt: createdAt,
  };
}

// Everything the read tools look things up in, for one account.
export class FakeWorkspace {
  constructor(
    private services: Service[] = [],
    private builds: Build[] = [],
  ) {}

  async findByAccountAndId(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<Service | null> {
    return (
      this.services.find(
        (s) => s._id.equals(serviceId) && s.accountId.equals(accountId),
      ) ?? null
    );
  }

  // Newest first, as the repository returns them.
  async getBuilds(accountId: ObjectId, serviceId: ObjectId): Promise<Build[]> {
    return this.builds
      .filter(
        (b) => b.serviceId.equals(serviceId) && b.accountId.equals(accountId),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}
