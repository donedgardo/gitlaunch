import { FourKeys } from "./fourKeys";

/**
 * The four keys, formatted for a screen.
 *
 * Kept apart from `computeFourKeys` on purpose: the calculation argues about
 * what counts as a failure, this argues about what a person can read. Both
 * are pure, so neither has to be exercised through a route to be tested.
 */
export type FourKeysView = {
  /** e.g. "3.3/day", "2.0/wk", or "—" when nothing has shipped. */
  deploymentFrequency: string;
  /** e.g. "2h 15m", or "—" when never measured. */
  leadTime: string;
  /** e.g. "13%", or "—" when there were no changes to fail. */
  changeFailureRate: string;
  /** e.g. "45m", or "—" when nothing has ever had to be restored. */
  timeToRestore: string;
  /** Whether this environment has any deployment history at all. */
  hasData: boolean;
  /**
   * Whether the sample is too small to draw a conclusion from.
   *
   * A "33% change failure rate" over three deploys is one bad afternoon, not
   * a trend, and putting it on a dashboard unqualified invites exactly the
   * wrong conversation. The panel renders the number either way — it just
   * has to be able to say how much is behind it.
   */
  lowConfidence: boolean;
  /**
   * What the lead time actually measures.
   *
   * `"commit"` is the DORA definition. `"reported"` means no pipeline sent a
   * commit time, so the number starts when we first heard about the build and
   * hides however long the change waited for a runner — a flattering figure
   * we must not present as delivery time. `"mixed"` is a median over both.
   */
  leadTimeBasis: LeadTimeBasis;
  sample: FourKeys["sample"];
};

export type LeadTimeBasis = "commit" | "reported" | "mixed" | "none";

/** What we print when a metric has genuinely never been measured. */
const NO_DATA = "—";

/**
 * Below this many deployments in the window, the four keys are describing a
 * handful of afternoons rather than a delivery process.
 */
export const LOW_CONFIDENCE_DEPLOYMENTS = 5;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A duration at the coarsest unit that still says something.
 *
 * Lead time spans minutes to weeks across real teams, so a single unit is
 * always wrong somewhere: "0.002 days" and "4,320 minutes" are both unreadable.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null) {
    return NO_DATA;
  }
  if (ms < MINUTE) {
    return "<1m";
  }
  if (ms < HOUR) {
    return `${Math.round(ms / MINUTE)}m`;
  }
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.round((ms % HOUR) / MINUTE);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  const days = Math.floor(ms / DAY);
  const hours = Math.round((ms % DAY) / HOUR);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

/**
 * Deployment frequency at whatever cadence the team actually ships at.
 *
 * DORA's own bands run from multiple deploys a day down to less than once a
 * month, and "0.066/day" tells a monthly shipper nothing. The rate is the
 * same number either way; only the unit moves.
 */
export function formatFrequency(perDay: number): string {
  if (perDay <= 0) {
    return NO_DATA;
  }
  if (perDay >= 1) {
    return `${perDay.toFixed(1)}/day`;
  }
  const perWeek = perDay * 7;
  if (perWeek >= 1) {
    return `${perWeek.toFixed(1)}/wk`;
  }
  return `${(perDay * 30).toFixed(1)}/mo`;
}

/** A 0–1 rate as a whole percentage, or a blank when there is no rate. */
export function formatRate(rate: number | null): string {
  if (rate === null) {
    return NO_DATA;
  }
  return `${Math.round(rate * 100)}%`;
}

function leadTimeBasisOf(sample: FourKeys["sample"]): LeadTimeBasis {
  if (sample.leadTimes === 0) {
    return "none";
  }
  if (sample.leadTimesFromCommit === 0) {
    return "reported";
  }
  return sample.leadTimesFromCommit === sample.leadTimes ? "commit" : "mixed";
}

export function toFourKeysView(keys: FourKeys): FourKeysView {
  const hasData = keys.sample.deployments > 0;

  return {
    deploymentFrequency: formatFrequency(keys.deploymentFrequencyPerDay),
    leadTime: formatDuration(keys.medianLeadTimeMs),
    changeFailureRate: formatRate(keys.changeFailureRate),
    timeToRestore: formatDuration(keys.medianTimeToRestoreMs),
    hasData,
    lowConfidence:
      hasData && keys.sample.deployments < LOW_CONFIDENCE_DEPLOYMENTS,
    leadTimeBasis: leadTimeBasisOf(keys.sample),
    sample: keys.sample,
  };
}
