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
    const rows = await this.collection
      .aggregate<{
        _id: { variant: string | null; event: string };
        entities: number;
      }>([
        {
          $match: {
            accountId: params.accountId,
            event: { $in: [EXPOSURE_EVENT, CONVERSION_EVENT] },
            "properties.serviceId": params.serviceId.toString(),
            "properties.flagKey": params.flagKey,
            "properties.environment": params.environment,
            timestamp: { $gte: params.from, $lt: params.to },
          },
        },
        // Collapse to unique (variant, event, entity) first so each entity is
        // counted at most once per variant/event, then tally the entities.
        {
          $group: {
            _id: {
              variant: "$properties.variant",
              event: "$event",
              distinctId: "$distinctId",
            },
          },
        },
        {
          $group: {
            _id: { variant: "$_id.variant", event: "$_id.event" },
            entities: { $sum: 1 },
          },
        },
      ])
      .toArray();

    // Fold the (variant, event) rows into per-variant exposure/conversion pairs.
    const byVariant = new Map<
      string,
      { exposures: number; conversions: number }
    >();
    for (const row of rows) {
      const label = this.variantLabel(row._id.variant);
      const entry = byVariant.get(label) ?? { exposures: 0, conversions: 0 };
      if (row._id.event === EXPOSURE_EVENT) {
        entry.exposures += row.entities;
      } else {
        entry.conversions += row.entities;
      }
      byVariant.set(label, entry);
    }

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
      flagKey: params.flagKey,
      environment: params.environment,
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
