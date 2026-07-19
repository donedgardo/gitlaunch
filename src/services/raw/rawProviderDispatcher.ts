import {
  DispatchContext,
  ProviderDispatcher,
} from "../dispatch/providerDispatcher";
import { RawDispatchService } from "./rawDispatchService";

export class RawProviderDispatcher implements ProviderDispatcher {
  readonly provider = "raw" as const;

  constructor(private rawDispatch: RawDispatchService) {}

  async dispatch({
    service,
    buildId,
    environment,
  }: DispatchContext): Promise<void> {
    if (service.deployment?.provider !== "raw") {
      throw new Error("Service is not configured for raw deployment");
    }
    if (!service.deployment.endpointUrl) {
      throw new Error("Raw deploy endpoint is not configured for this service");
    }

    await this.rawDispatch.dispatch({
      endpointUrl: service.deployment.endpointUrl,
      buildId,
      environment,
    });
  }
}
