import { CampaignRow } from "./campaignAnalyticsService";
import { ExperimentAnalysis, Recommendation } from "./experimentAnalysis";
import {
  ActiveUsersPoint,
  AudienceBreakdown,
  FeatureAdoptionRow,
  FunnelStep,
} from "./productUsageService";

export type InsightsReport = {
  from: Date;
  to: Date;
  campaigns: CampaignRow[];
  experiments: ExperimentAnalysis[];
  usage: {
    // Logged-in people only — see `audience` for everyone else who was active.
    activeUsers: ActiveUsersPoint[];
    audience: AudienceBreakdown;
    features: FeatureAdoptionRow[];
    funnel: FunnelStep[];
  };
  // Things that make the numbers above less trustworthy than they look.
  warnings: string[];
};

/**
 * Renders the marketing + product briefing as markdown: readable in a
 * terminal, pasteable into a doc, and parseable by an agent answering
 * questions about it.
 */
export function renderInsightsReport(report: InsightsReport): string {
  return [
    `# Product & marketing insights`,
    ``,
    `**Window:** ${day(report.from)} → ${day(report.to)}`,
    ``,
    renderWarnings(report.warnings),
    renderCampaigns(report.campaigns),
    renderExperiments(report.experiments),
    renderUsage(report.usage),
  ]
    .filter((section) => section !== "")
    .join("\n");
}

function renderWarnings(warnings: string[]): string {
  if (warnings.length === 0) return "";
  return [`## ⚠️ Data quality`, ``, ...warnings.map((w) => `- ${w}`), ``].join(
    "\n",
  );
}

function renderCampaigns(campaigns: CampaignRow[]): string {
  const lines = [`## Marketing campaigns`, ``];

  if (campaigns.length === 0) {
    lines.push(
      `_No campaign data in this window — no \`waitlist_signup\` events were captured._`,
      ``,
    );
    return lines.join("\n");
  }

  const total = campaigns.reduce((sum, c) => sum + c.signups, 0);
  lines.push(
    `**${count(total)} signup${total === 1 ? "" : "s"}** across ${count(campaigns.length)} campaign/source/medium combination${campaigns.length === 1 ? "" : "s"}.`,
    ``,
    `| Campaign | Source | Medium | Signups | Unique | First | Last |`,
    `| --- | --- | --- | ---: | ---: | --- | --- |`,
    ...campaigns.map(
      (c) =>
        `| ${c.campaign} | ${c.source} | ${c.medium} | ${count(c.signups)} | ${count(c.uniqueVisitors)} | ${day(c.firstSignup)} | ${day(c.lastSignup)} |`,
    ),
    ``,
  );
  return lines.join("\n");
}

function renderExperiments(experiments: ExperimentAnalysis[]): string {
  const lines = [`## A/B experiments`, ``];

  if (experiments.length === 0) {
    lines.push(
      `_No experiment data in this window — no \`flag_exposure\` events were captured._`,
      ``,
    );
    return lines.join("\n");
  }

  for (const experiment of experiments) {
    lines.push(
      `### \`${experiment.flagKey}\` (${experiment.environment})`,
      ``,
      `**Verdict:** ${verdictLine(experiment)}`,
      ``,
    );

    if (experiment.comparisons.length === 0) {
      lines.push(
        `Only one arm received traffic, so there is nothing to compare.`,
        ``,
      );
      continue;
    }

    lines.push(
      `| Variant | Conv. rate | vs ${experiment.baseline} | Confidence | Verdict |`,
      `| --- | ---: | ---: | ---: | --- |`,
      `| ${experiment.baseline} (baseline) | ${percent(experiment.comparisons[0].baselineRate)} | — | — | baseline |`,
      ...experiment.comparisons.map(
        (c) =>
          `| ${c.variant} | ${percent(c.variantRate)} | ${signed(c.relativeLift)} | ${c.confidence == null ? "—" : percent(c.confidence)} | ${c.verdict} |`,
      ),
      ``,
    );
  }

  return lines.join("\n");
}

function verdictLine(experiment: ExperimentAnalysis): string {
  const messages: Record<Recommendation, string> = {
    ship: `Ship **${experiment.winner}** — it beat \`${experiment.baseline}\` significantly.`,
    "keep-control": `Keep \`${experiment.baseline}\` — every challenger did significantly worse.`,
    "keep-running": `Keep running — no arm has separated yet. Needs roughly **${count(experiment.shortfallPerVariant)} more** per arm (${count(experiment.requiredSamplePerVariant)} total each) to detect a 20% relative change.`,
    "no-comparison": `Nothing to compare — only one arm has traffic.`,
  };
  return messages[experiment.recommendation];
}

function renderUsage(usage: InsightsReport["usage"]): string {
  const lines = [`## Product usage`, ``];

  if (usage.activeUsers.length === 0 && usage.features.length === 0) {
    lines.push(`_No product usage captured in this window._`, ``);
    return lines.join("\n");
  }

  if (usage.activeUsers.length > 0) {
    const peak = Math.max(...usage.activeUsers.map((p) => p.users));
    lines.push(
      `**Active product users** (peak ${count(peak)} in a bucket) — logged-in people only`,
      ``,
      `| Bucket | Product users |`,
      `| --- | ---: |`,
      ...usage.activeUsers.map(
        (p) => `| ${day(p.bucket)} | ${count(p.users)} |`,
      ),
      ``,
    );
  }

  lines.push(renderAudience(usage.audience));

  if (usage.features.length > 0) {
    lines.push(
      `**Feature adoption**`,
      ``,
      `| Event | Users | Occurrences |`,
      `| --- | ---: | ---: |`,
      ...usage.features.map(
        (f) => `| ${f.event} | ${count(f.users)} | ${count(f.occurrences)} |`,
      ),
      ``,
    );
  }

  if (usage.funnel.length > 0) {
    lines.push(
      `**Activation funnel**`,
      ``,
      `| Step | Users | % of entrants | % of previous |`,
      `| --- | ---: | ---: | ---: |`,
      ...usage.funnel.map(
        (s) =>
          `| ${s.step} | ${count(s.users)} | ${percent(s.rateFromStart)} | ${percent(s.rateFromPrevious)} |`,
      ),
      ``,
    );
  }

  return lines.join("\n");
}

/**
 * Everyone who showed up, split by what they are. Rendered next to the
 * headline so a landing-page traffic spike is never read as product growth.
 */
function renderAudience(audience: AudienceBreakdown): string {
  const total =
    audience.user + audience.visitor + audience.machine + audience.unknown;
  if (total === 0) return "";

  return [
    `**Who was active** (${count(total)} distinct actors)`,
    ``,
    `| Actor | Count | What it is |`,
    `| --- | ---: | --- |`,
    `| product users | ${count(audience.user)} | logged-in people |`,
    `| anonymous visitors | ${count(audience.visitor)} | landing-page \`gl_vid\` cookies, not users |`,
    `| machines | ${count(audience.machine)} | API keys (CI reporting builds) |`,
    `| unidentified | ${count(audience.unknown)} | leads and anything else |`,
    ``,
  ].join("\n");
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function count(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "∞";
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signed(value: number | null): string {
  if (value == null) return "n/a";
  const rendered = percent(Math.abs(value));
  return value >= 0 ? `+${rendered}` : `−${rendered}`;
}
