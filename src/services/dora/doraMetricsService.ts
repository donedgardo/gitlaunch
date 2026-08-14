import { ObjectId } from "mongodb";
import { BuildRepository } from "../../repositories/buildRepository";
import {
  computeFourKeys,
  DeploymentEvent,
  FourKeys,
  MeasurementWindow,
} from "./fourKeys";

/**
 * The DORA four keys for a service, measured from its own deployment log.
 *
 * The imperative shell: it reads builds and flattens their deployment logs
 * into events. Every measurement rule lives in `computeFourKeys`, which is
 * pure — so what counts as a failure is settled in tests, not in a query.
 */
export class DoraMetricsService {
  constructor(private buildRepo: BuildRepository) {}

  async forService(
    accountId: ObjectId,
    serviceId: ObjectId,
    environment: string,
    window: MeasurementWindow,
  ): Promise<FourKeys> {
    const builds = await this.buildRepo.findByAccountAndService(
      accountId,
      serviceId,
    );

    const events: DeploymentEvent[] = [];
    for (const build of builds) {
      for (const log of build.deploymentLogs) {
        // Entries written before the log was timestamped cannot be placed on
        // a timeline. Dropping them narrows the window we can report on;
        // keeping them would put deploys at the wrong moment.
        if (!log.at) {
          continue;
        }
        events.push({
          buildId: build.buildId,
          environment: log.environment,
          status: log.status,
          at: log.at,
          // Lead time starts when GitLaunch first heard about the build, not
          // when the change was committed. That makes it a floor on the real
          // DORA number — see `DeploymentEvent.changeAt`.
          changeAt: build.createdAt,
          intent: log.intent,
        });
      }
    }

    return computeFourKeys(events, environment, window);
  }
}
