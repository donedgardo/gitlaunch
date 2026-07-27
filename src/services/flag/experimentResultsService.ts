import { Collection, Db, ObjectId } from "mongodb";
import { AnalyticsEvent } from "../../repositories/analyticsEventRepository";

export type ExperimentResultsQuery = {
  accountId: ObjectId;
  serviceId: ObjectId;
  flagKey: string;
  environment: string;
  from: Date;
  to: Date;
};

// Environments are parallel, not a promotion ladder, so an experiment may be
// running in any of them — or several at once. This query names none.
export type AllEnvironmentsQuery = Omit<ExperimentResultsQuery, "environment">;

export type VariantResult = {
  variant: string;
  exposures: number;
  conversions: number;
  conversionRate: number;
};

export type ExperimentResults = {
  flagKey: string;
  environment: string;
  variants: VariantResult[];
  totals: {
    exposures: number;
    conversions: number;
    conversionRate: number;
  };
};

// Events emitted into the analytics warehouse for experiment measurement.
export const EXPOSURE_EVENT = "flag_exposure";
export const CONVERSION_EVENT = "flag_conversion";

// Label used when a variant is null (boolean rollout flag: the treatment group
// has no named variant, so it's reported as the single "(control)" cohort).
const NULL_VARIANT_LABEL = "(control)";

/**
 * Read-side experiment metrics over the analytics warehouse. For a single flag
 * in one environment it counts, per variant, the number of unique entities
 * exposed and the number that converted, then derives a conversion rate.
 *
 * Uniqueness is by distinctId (the evaluation entity), so re-exposing or
 * re-converting the same entity is counted once. Every query is scoped to one
 * account (tenant isolation).
 */
export class ExperimentResultsService {
  private collection: Collection<AnalyticsEvent>;

  constructor(db: Db) {
    this.collection = db.collection<AnalyticsEvent>("analytics_events");
  }

  async getResults(params: ExperimentResultsQuery): Promise<ExperimentResults> {
    const rows = await this.tally(params, params.environment);
    const byEnvironment = this.foldByEnvironment(params.flagKey, rows);

    // An experiment with no events still reports as an empty result for the
    // environment that was asked about.
    return (
      byEnvironment.get(params.environment) ??
      this.buildResults(params.flagKey, params.environment, new Map())
    );
  }

  /**
   * Results for every environment this experiment has run in, each tallied
   * independently. Environments are discovered from the events themselves
   * rather than from the flag's current config, so an environment that was
   * renamed or removed still reports the traffic it collected.
   *
   * Deliberately NOT pooled into a single figure: environments differ in
   * traffic mix, so combining them invites Simpson's paradox. Each is a
   * separate experiment and gets its own verdict.
   */
  async getResultsByEnvironment(
    params: AllEnvironmentsQuery,
  ): Promise<ExperimentResults[]> {
    const rows = await this.tally(params);
    const results = [...this.foldByEnvironment(params.flagKey, rows).values()];

    // Busiest environment first; stable tie-break by name.
    results.sort(
      (a, b) =>
        b.totals.exposures - a.totals.exposures ||
        a.environment.localeCompare(b.environment),
    );
    return results;
  }

  private async tally(params: AllEnvironmentsQuery, environment?: string) {
    return this.collection
      .aggregate<{
        _id: { environment: string; variant: string | null; event: string };
        entities: number;
      }>([
        {
          $match: {
            accountId: params.accountId,
            event: { $in: [EXPOSURE_EVENT, CONVERSION_EVENT] },
            "properties.serviceId": params.serviceId.toString(),
            "properties.flagKey": params.flagKey,
            ...(environment === undefined
              ? {}
              : { "properties.environment": environment }),
            timestamp: { $gte: params.from, $lt: params.to },
          },
        },
        // Collapse to unique (environment, variant, event, entity) first so each
        // entity is counted at most once per variant/event, then tally them.
        {
          $group: {
            _id: {
              environment: "$properties.environment",
              variant: "$properties.variant",
              event: "$event",
              distinctId: "$distinctId",
            },
          },
        },
        {
          $group: {
            _id: {
              environment: "$_id.environment",
              variant: "$_id.variant",
              event: "$_id.event",
            },
            entities: { $sum: 1 },
          },
        },
      ])
      .toArray();
  }

  // Fold the (environment, variant, event) rows into one result per environment.
  private foldByEnvironment(
    flagKey: string,
    rows: Array<{
      _id: { environment: string; variant: string | null; event: string };
      entities: number;
    }>,
  ): Map<string, ExperimentResults> {
    const byEnvironment = new Map<
      string,
      Map<string, { exposures: number; conversions: number }>
    >();

    for (const row of rows) {
      const environment = row._id.environment;
      const byVariant = byEnvironment.get(environment) ?? new Map();
      const label = this.variantLabel(row._id.variant);
      const entry = byVariant.get(label) ?? { exposures: 0, conversions: 0 };
      if (row._id.event === EXPOSURE_EVENT) {
        entry.exposures += row.entities;
      } else {
        entry.conversions += row.entities;
      }
      byVariant.set(label, entry);
      byEnvironment.set(environment, byVariant);
    }

    const results = new Map<string, ExperimentResults>();
    for (const [environment, byVariant] of byEnvironment) {
      results.set(
        environment,
        this.buildResults(flagKey, environment, byVariant),
      );
    }
    return results;
  }

  private buildResults(
    flagKey: string,
    environment: string,
    byVariant: Map<string, { exposures: number; conversions: number }>,
  ): ExperimentResults {
    const variants: VariantResult[] = [...byVariant.entries()].map(
      ([variant, { exposures, conversions }]) => ({
        variant,
        exposures,
        conversions,
        conversionRate: this.rate(conversions, exposures),
      }),
    );

    // Most-exposed variant first; stable tie-break by name.
    variants.sort(
      (a, b) => b.exposures - a.exposures || a.variant.localeCompare(b.variant),
    );

    const totalExposures = variants.reduce((s, v) => s + v.exposures, 0);
    const totalConversions = variants.reduce((s, v) => s + v.conversions, 0);

    return {
      flagKey,
      environment,
      variants,
      totals: {
        exposures: totalExposures,
        conversions: totalConversions,
        conversionRate: this.rate(totalConversions, totalExposures),
      },
    };
  }

  private variantLabel(variant: string | null | undefined): string {
    return variant == null ? NULL_VARIANT_LABEL : variant;
  }

  private rate(conversions: number, exposures: number): number {
    return exposures > 0 ? conversions / exposures : 0;
  }
}
