import { ObjectId } from "mongodb";
import {
  LeadRepository,
  LeadAttribution,
} from "../../repositories/leadRepository";
import { AnalyticsContext, AnalyticsService } from "../analytics/analytics";
import { evaluateSubmission, BotConfig, BotReason } from "./botDetection";
import { InternalTraffic } from "../analytics/internalTraffic";

export type WaitlistSubmission = {
  email: string;
  honeypot?: string;
  elapsedMs?: number;
  attribution?: LeadAttribution;
  // Stable anonymous visitor id (the landing page's gl_vid cookie). Becomes the
  // event's distinctId so a signup joins the same visitor's A/B exposure.
  visitorId?: string;
};

// The GitLaunch account these marketing events belong to. Every analytics query
// is scoped to a tenant, so events written without one are invisible on
// /dashboard/analytics. SelfFlagAccount satisfies this shape.
export interface OwningAccount {
  resolve(): Promise<ObjectId | null>;
}

export type WaitlistOutcome =
  | { status: "subscribed"; alreadyOnList: boolean }
  | { status: "rejected"; reason: BotReason };

// Orchestrates the waitlist capture: filter out bots, persist real
// leads, and stream the marketing signal into the analytics framework so
// campaigns can be compared by source/campaign.
export class WaitlistService {
  constructor(
    private leads: LeadRepository,
    private analytics: AnalyticsService,
    private config: BotConfig,
    // Absent (or unresolvable) => events are still emitted, just untenanted, so
    // capturing the lead never depends on the analytics dashboard being wired.
    private ownAccount?: OwningAccount,
    // Recognises the team's own addresses. Their leads are still captured — we
    // just stamp the event so acquisition reporting can leave it out.
    private internal: InternalTraffic = InternalTraffic.fromEnv({}),
  ) {}

  async submit(submission: WaitlistSubmission): Promise<WaitlistOutcome> {
    const attribution = submission.attribution ?? {};
    const context = await this.analyticsContext(submission.visitorId);

    const verdict = evaluateSubmission(
      {
        email: submission.email,
        honeypot: submission.honeypot,
        elapsedMs: submission.elapsedMs,
      },
      this.config,
    );

    if (!verdict.human) {
      // Track the block (not the email) so we can see bot pressure per campaign
      // without polluting the lead list.
      this.analytics.track(
        "waitlist_bot_blocked",
        {
          reason: verdict.reason,
          campaign: attribution.campaign,
          source: attribution.source,
        },
        context,
      );
      return { status: "rejected", reason: verdict.reason };
    }

    const { created, lead } = await this.leads.capture({
      email: submission.email,
      attribution,
    });

    if (!created) {
      // Idempotent resubmit — keep them on the list but don't inflate counts.
      return { status: "subscribed", alreadyOnList: true };
    }

    this.analytics.identify(
      lead.email,
      {
        email: lead.email,
        campaign: attribution.campaign,
        source: attribution.source,
      },
      context,
    );
    this.analytics.track(
      "waitlist_signup",
      {
        campaign: attribution.campaign,
        source: attribution.source,
        medium: attribution.medium,
        content: attribution.content,
        term: attribution.term,
        // Names the lead this signup created, so the warehouse and the leads
        // table can be reconciled exactly rather than matched by timestamp.
        leadId: lead._id.toString(),
        // Only stamped when true, so genuine signups keep the exact shape they
        // had before internal filtering existed.
        ...(this.internal.isInternalEmail(lead.email)
          ? { internal: true }
          : {}),
      },
      context,
    );

    return { status: "subscribed", alreadyOnList: false };
  }

  // Tenant + visitor for the warehouse. Resolving the account must never cost
  // us a lead, so a failure degrades to the previous untenanted behaviour.
  private async analyticsContext(
    visitorId?: string,
  ): Promise<AnalyticsContext | undefined> {
    const accountId = await this.ownAccount?.resolve().catch(() => null);
    if (!accountId) return visitorId ? { distinctId: visitorId } : undefined;
    return {
      accountId: accountId.toString(),
      distinctId: visitorId || undefined,
    };
  }
}
