import { ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import {
  ServiceRepository,
  CIProvider,
} from "../../repositories/serviceRepository";
import { ProviderDispatcher } from "../dispatch/providerDispatcher";

export interface BuildDispatchServiceI {
  dispatch(
    accountId: ObjectId,
    serviceId: ObjectId,
    buildId: string,
    environment: string,
  ): Promise<void>;
}

export class BuildDispatchService implements BuildDispatchServiceI {
  private dispatchers: Map<CIProvider, ProviderDispatcher>;

  constructor(
    private accountRepo: AccountRepository,
    private serviceRepo: ServiceRepository,
    dispatchers: ProviderDispatcher[],
  ) {
    this.dispatchers = new Map(dispatchers.map((d) => [d.provider, d]));
  }

  async dispatch(
    accountId: ObjectId,
    serviceId: ObjectId,
    buildId: string,
    environment: string,
  ): Promise<void> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    const service = await this.serviceRepo.findById(serviceId);
    if (!service) {
      throw new Error("Service not found");
    }

    const dispatcher = this.dispatchers.get(service.ciProvider);
    if (!dispatcher) {
      throw new Error(`No dispatcher for provider '${service.ciProvider}'`);
    }

    await dispatcher.dispatch({ account, service, buildId, environment });
  }
}

// No-op implementation for testing
export class NoOpBuildDispatchService implements BuildDispatchServiceI {
  async dispatch(
    _accountId: ObjectId,
    _serviceId: ObjectId,
    _buildId: string,
    _environment: string,
  ): Promise<void> {
    // No-op
  }
}
