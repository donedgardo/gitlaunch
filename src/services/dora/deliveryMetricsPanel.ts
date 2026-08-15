import { ObjectId } from "mongodb";
import { DoraMetricsService } from "./doraMetricsService";
import { toFourKeysView, FourKeysView } from "./fourKeysView";

/**
 * How far back the delivery metrics page looks.
 *
 * Long enough that a weekly-shipping team has something to show, short enough
 * that the numbers describe how the team works now rather than last quarter.
 */
export const DORA_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DeliveryMetricsPanel = {
  windowDays: number;
  environments: Array<{ name: string } & FourKeysView>;
};

/**
 * The four keys for each of a service's environments, ready to render.
 *
 * Fail-soft: returns null when the metrics cannot be read, so the page can say
 * so rather than break. An environment that has never deployed is *not* a
 * failure — it comes back as a row that says as much, because on a page the
 * customer opened on purpose, "nothing yet" is the answer they came for.
 */
export async function loadDeliveryMetricsPanel(
  doraMetricsService: DoraMetricsService,
  accountId: ObjectId,
  serviceId: ObjectId,
  environmentNames: string[],
  now: Date = new Date(),
): Promise<DeliveryMetricsPanel | null> {
  try {
    const to = now;
    const from = new Date(to.getTime() - DORA_WINDOW_DAYS * DAY_MS);
    const keys = await doraMetricsService.forEnvironments(
      accountId,
      serviceId,
      environmentNames,
      { from, to },
    );

    return {
      windowDays: DORA_WINDOW_DAYS,
      environments: environmentNames.map((name) => ({
        name,
        ...toFourKeysView(keys[name]),
      })),
    };
  } catch {
    return null;
  }
}
