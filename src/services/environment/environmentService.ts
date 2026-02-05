import { ObjectId } from "mongodb";
import {
  ServiceRepository,
  Service,
  Environment,
} from "../../repositories/serviceRepository";

export type AddEnvironmentInput = {
  name: string;
  displayName: string;
};

export type UpdateEnvironmentInput = {
  displayName?: string;
  order?: number;
};

const ENV_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class EnvironmentService {
  constructor(private serviceRepo: ServiceRepository) {}

  async listEnvironments(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<Environment[]> {
    const service = await this.getServiceOrThrow(accountId, serviceId);
    return service.environments;
  }

  async addEnvironment(
    accountId: ObjectId,
    serviceId: ObjectId,
    input: AddEnvironmentInput,
  ): Promise<Service> {
    const service = await this.getServiceOrThrow(accountId, serviceId);

    // Validate name format
    if (!ENV_NAME_REGEX.test(input.name)) {
      throw new Error(
        "Environment name must be lowercase alphanumeric with hyphens",
      );
    }

    // Check for duplicate name
    if (service.environments.some((e) => e.name === input.name)) {
      throw new Error("Environment name already exists");
    }

    // Calculate next order
    const maxOrder = Math.max(...service.environments.map((e) => e.order), -1);

    const newEnv: Environment = {
      name: input.name,
      displayName: input.displayName,
      order: maxOrder + 1,
    };

    const result = await this.serviceRepo.addEnvironment(serviceId, newEnv);
    if (!result) {
      throw new Error("Failed to add environment");
    }
    return result;
  }

  async updateEnvironment(
    accountId: ObjectId,
    serviceId: ObjectId,
    envName: string,
    updates: UpdateEnvironmentInput,
  ): Promise<Service> {
    const service = await this.getServiceOrThrow(accountId, serviceId);

    // Check environment exists
    const targetEnv = service.environments.find((e) => e.name === envName);
    if (!targetEnv) {
      throw new Error("Environment not found");
    }

    // If order is being changed, we need to reorder all environments
    if (updates.order !== undefined && updates.order !== targetEnv.order) {
      const newOrder = updates.order;
      const oldOrder = targetEnv.order;

      // Update all environments to shift positions
      for (const env of service.environments) {
        if (env.name === envName) {
          // This is the env being moved - will be updated below
          continue;
        }

        // Shift environments between old and new position
        if (oldOrder < newOrder) {
          // Moving down: shift environments in between up
          if (env.order > oldOrder && env.order <= newOrder) {
            await this.serviceRepo.updateEnvironment(serviceId, env.name, {
              order: env.order - 1,
            });
          }
        } else {
          // Moving up: shift environments in between down
          if (env.order >= newOrder && env.order < oldOrder) {
            await this.serviceRepo.updateEnvironment(serviceId, env.name, {
              order: env.order + 1,
            });
          }
        }
      }
    }

    const result = await this.serviceRepo.updateEnvironment(
      serviceId,
      envName,
      updates,
    );
    if (!result) {
      throw new Error("Failed to update environment");
    }
    return result;
  }

  async removeEnvironment(
    accountId: ObjectId,
    serviceId: ObjectId,
    envName: string,
  ): Promise<Service> {
    const service = await this.getServiceOrThrow(accountId, serviceId);

    // Check environment exists
    if (!service.environments.some((e) => e.name === envName)) {
      throw new Error("Environment not found");
    }

    // Check minimum requirement
    if (service.environments.length <= 1) {
      throw new Error("Cannot remove the last environment");
    }

    const result = await this.serviceRepo.removeEnvironment(serviceId, envName);
    if (!result) {
      throw new Error("Failed to remove environment");
    }
    return result;
  }

  private async getServiceOrThrow(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<Service> {
    const service = await this.serviceRepo.findByAccountAndId(
      accountId,
      serviceId,
    );
    if (!service) {
      throw new Error("Service not found");
    }
    return service;
  }
}
