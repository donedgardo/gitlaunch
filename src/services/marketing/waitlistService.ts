import {
  LeadRepository,
  LeadAttribution,
} from "../../repositories/leadRepository";
import { AnalyticsService } from "../analytics/analytics";
import { evaluateSubmission, BotConfig, BotReason } from "./botDetection";

export type WaitlistSubmission = {
  email: string;
  honeypot?: string;
  elapsedMs?: number;
  attribution?: LeadAttribution;
};

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
  ) {}

  async submit(submission: WaitlistSubmission): Promise<WaitlistOutcome> {
    const attribution = submission.attribution ?? {};

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
      this.analytics.track("waitlist_bot_blocked", {
        reason: verdict.reason,
        campaign: attribution.campaign,
        source: attribution.source,
      });
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

    this.analytics.identify(lead.email, {
      email: lead.email,
      campaign: attribution.campaign,
      source: attribution.source,
    });
    this.analytics.track("waitlist_signup", {
      campaign: attribution.campaign,
      source: attribution.source,
      medium: attribution.medium,
      content: attribution.content,
      term: attribution.term,
    });

    return { status: "subscribed", alreadyOnList: false };
  }
}
