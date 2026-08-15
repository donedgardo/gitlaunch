import { ObjectId } from "mongodb";
import { DoraMetricsService } from "./doraMetricsService";
import { toFourKeysView, FourKeysView } from "./fourKeysView";
import { toDeploymentAttempts } from "./deploymentHistory";
import {
  toDeploymentHistoryView,
  DeploymentHistoryEntry,
} from "./deploymentHistoryView";

/**
 * How far back the delivery metrics page looks.
 *
 * Long enough that a weekly-shipping team has something to show, short enough
 * that the numbers describe how the team works now rather than last quarter.
 */
export const DORA_WINDOW_DAYS = 30;

/**
 * How many deployments the history lists.
 *
 * Enough to cover a busy fortnight, few enough that the page stays a summary.
 * The four keys say how delivery is going; the history is there to let someone
 * point at the deploy behind a number, not to be a full audit log.
 */
export const HISTORY_LIMIT = 25;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DeliveryMetricsPanel = {
  windowDays: number;
  environments: Array<{ name: string } & FourKeysView>;
  /** The deployments themselves, newest first. */
  history: DeploymentHistoryEntry[];
  historyLimit: number;
};

/**
 * What the delivery metrics page shows: the four keys per environment, and
 * the deployments they were measured from.
 *
 * Both come off one read of the deployment log, because they are two readings
 * of the same thing — a rate nobody can trace back to a deployment is a number
 * you cannot act on, and re-reading an unbounded build history to say it twice
 * would be paying for the page twice.
 *
 * Fail-soft: returns null when the log cannot be read, so the page can say so
 * rather than break. An environment that has never deployed is *not* a
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
    const events = await doraMetricsService.timelineFor(accountId, serviceId);
    const keys = doraMetricsService.keysByEnvironment(
      events,
      environmentNames,
      { from, to },
    );

    return {
      windowDays: DORA_WINDOW_DAYS,
      environments: environmentNames.map((name) => ({
        name,
        ...toFourKeysView(keys[name]),
      })),
      // Deliberately not clipped to the measurement window: the last thing
      // that shipped is worth seeing even on a service that has been quiet
      // for a month, and a history that empties itself out is a page that
      // looks broken.
      history: toDeploymentHistoryView(
        toDeploymentAttempts(events, { limit: HISTORY_LIMIT }),
      ),
      historyLimit: HISTORY_LIMIT,
    };
  } catch {
    return null;
  }
}
