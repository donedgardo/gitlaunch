import { Flag, FlagEnvironmentConfig } from "../../repositories/flagRepository";

// Per-environment flag state, as shown on the release board.
//
// The board's promise is that one screen answers "what is live here" — and a
// deploy only tells half that story. A build can be identical across two
// environments while behaving differently in each because of what's switched
// on inside it. These counts put the other half on the same screen.
export type EnvFlagSummary = {
  environment: string;
  hasFlags: boolean; // the service has flags at all; false => render nothing
  total: number; // flags belonging to the service
  on: number; // enabled in this environment
  rollingOut: number; // on, but only for a slice of traffic
  experiments: number; // on, and splitting traffic between variants
  label: string; // e.g. "1 of 3 flags on"
  detail: string; // e.g. "1 rolling out · 1 experiment"; "" when nothing notable
};

// A flag with no entry for an environment has never been configured there,
// which is indistinguishable from being off: it serves nothing.
const configFor = (
  flag: Flag,
  environment: string,
): FlagEnvironmentConfig | undefined => flag.environments?.[environment];

const isOn = (config: FlagEnvironmentConfig | undefined): boolean =>
  config?.enabled === true;

const plural = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? "" : "s"}`;

function summarizeOne(flags: Flag[], environment: string): EnvFlagSummary {
  const enabled = flags
    .map((flag) => configFor(flag, environment))
    .filter(isOn) as FlagEnvironmentConfig[];

  // A partial rollout means some users have the feature and some don't, so
  // "what's live here" genuinely differs per user — worth surfacing.
  const rollingOut = enabled.filter(
    (config) => config.rolloutPercentage < 100,
  ).length;
  const experiments = enabled.filter(
    (config) => (config.variants?.length ?? 0) > 0,
  ).length;

  const total = flags.length;
  const on = enabled.length;

  const detailParts: string[] = [];
  if (rollingOut > 0) detailParts.push(`${rollingOut} rolling out`);
  if (experiments > 0) detailParts.push(plural(experiments, "experiment"));

  return {
    environment,
    hasFlags: total > 0,
    total,
    on,
    rollingOut,
    experiments,
    label: total > 0 ? `${on} of ${plural(total, "flag")} on` : "",
    detail: detailParts.join(" · "),
  };
}

// Pure: given a service's flags, describe each environment's flag state.
// Returns one summary per requested environment, in the order given.
export function summarizeEnvironmentFlags(
  flags: Flag[],
  environmentNames: string[],
): EnvFlagSummary[] {
  return environmentNames.map((environment) =>
    summarizeOne(flags, environment),
  );
}
