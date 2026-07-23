import { Db, ObjectId, Collection } from "mongodb";

// Campaign attribution captured from UTM parameters on the inbound link.
// Every field is optional — direct/untagged traffic still becomes a lead.
export type LeadAttribution = {
  source?: string; // utm_source  — where (hackernews, twitter, devto…)
  medium?: string; // utm_medium  — type (community, social, email…)
  campaign?: string; // utm_campaign — the campaign slug (alpha-launch…)
  term?: string; // utm_term    — optional keyword
  content?: string; // utm_content — variant, for A/B testing
  referrer?: string; // document referrer, as a fallback signal
};

export type Lead = {
  _id: ObjectId;
  email: string;
  attribution: LeadAttribution;
  createdAt: Date;
};

export type CaptureInput = {
  email: string;
  attribution?: LeadAttribution;
  createdAt?: Date;
};

export type CaptureResult = { created: boolean; lead: Lead };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class LeadRepository {
  private collection: Collection<Lead>;

  constructor(db: Db) {
    this.collection = db.collection<Lead>("leads");
  }

  // Idempotent by email: the first capture wins on attribution, so we preserve
  // the original acquisition source even if someone resubmits from a later
  // campaign. Returns created=false when the email was already on the list.
  async capture(input: CaptureInput): Promise<CaptureResult> {
    const email = normalizeEmail(input.email);
    const existing = await this.collection.findOne({ email });
    if (existing) {
      return { created: false, lead: existing };
    }

    const lead: Lead = {
      _id: new ObjectId(),
      email,
      attribution: input.attribution ?? {},
      createdAt: input.createdAt ?? new Date(),
    };

    try {
      await this.collection.insertOne(lead);
      return { created: true, lead };
    } catch (error: any) {
      // Lost a race to another concurrent capture of the same email.
      if (error.code === 11000) {
        const current = await this.collection.findOne({ email });
        if (current) return { created: false, lead: current };
      }
      throw error;
    }
  }

  async findByEmail(email: string): Promise<Lead | null> {
    return this.collection.findOne({ email: normalizeEmail(email) });
  }

  async count(): Promise<number> {
    return this.collection.countDocuments();
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ email: 1 }, { unique: true });
    await this.collection.createIndex({ "attribution.campaign": 1 });
    await this.collection.createIndex({ createdAt: -1 });
  }
}
