import {
  DispatchContext,
  ProviderDispatcher,
} from "../dispatch/providerDispatcher";
import { planJenkinsDispatch } from "../dispatch/planDispatch";
import { JenkinsConnectionService } from "./jenkinsConnectionService";
import { JenkinsDispatchService } from "./jenkinsDispatchService";

export class JenkinsProviderDispatcher implements ProviderDispatcher {
  readonly provider = "jenkins" as const;

  constructor(
    private jenkinsConnection: JenkinsConnectionService,
    private jenkinsDispatch: JenkinsDispatchService,
  ) {}

  async dispatch({
    account,
    service,
    buildId,
    environment,
  }: DispatchContext): Promise<void> {
    if (service.deployment?.provider !== "jenkins") {
      throw new Error("Service is not configured for Jenkins deployment");
    }
    const apiToken = await this.jenkinsConnection.getDecryptedToken(
      account._id,
    );
    const plan = planJenkinsDispatch(
      account.jenkinsConnection,
      apiToken,
      service.deployment.jobName,
      buildId,
      environment,
      service._id.toString(),
    );
    if (plan.kind === "validation-error") {
      throw new Error(plan.reason);
    }

    const { kind: _kind, ...input } = plan;
    await this.jenkinsDispatch.dispatch(input);
  }
}
