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
    const events = await this.eventsFor(accountId, serviceId);
    return computeFourKeys(events, environment, window);
  }

  /**
   * The four keys for several environments, from a single read.
   *
   * A release board asks about every column at once. Answering it with one
   * `forService` call per environment would re-read the whole build history
   * per column; the measurement is identical either way, so the only thing
   * that differs here is how often we hit the database.
   */
  async forEnvironments(
    accountId: ObjectId,
    serviceId: ObjectId,
    environments: readonly string[],
    window: MeasurementWindow,
  ): Promise<Record<string, FourKeys>> {
    const events = await this.eventsFor(accountId, serviceId);

    const byEnvironment: Record<string, FourKeys> = {};
    for (const environment of environments) {
      byEnvironment[environment] = computeFourKeys(events, environment, window);
    }
    return byEnvironment;
  }

  /** Every deployment outcome this service has recorded, as a flat timeline. */
  private async eventsFor(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<DeploymentEvent[]> {
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
          // Lead time starts when the change was committed, when CI told us.
          // A reporter that sends nothing leaves us measuring from when we
          // first heard about the build — a floor on the real DORA number,
          // since it drops however long the commit waited for a runner.
          changeAt: build.commitAt ?? build.createdAt,
          intent: log.intent,
        });
      }
    }

    return events;
  }
}
