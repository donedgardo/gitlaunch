// Lightweight, dependency-free bot detection for the waitlist capture.
// We don't want a captcha in front of early adopters, so we lean on three
// cheap, high-signal heuristics instead: a honeypot field, a submit-timing
// floor, and email validity. Kept pure so it is trivial to test and reason
// about — the route layer supplies the raw signals.

export type BotReason = "honeypot" | "too_fast" | "invalid_email";

export type SubmissionSignals = {
  email: string;
  // Hidden field a human never sees; only automated form-fillers populate it.
  honeypot?: string;
  // Milliseconds between the form being rendered and submitted. Optional —
  // absent when timing can't be measured, in which case we don't block.
  elapsedMs?: number;
};

export type BotConfig = {
  minElapsedMs: number;
};

export type Verdict = { human: true } | { human: false; reason: BotReason };

// Deliberately permissive but structurally strict: exactly one @, a dotted
// domain, no whitespace. Good enough to reject junk without rejecting real
// addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function evaluateSubmission(
  signals: SubmissionSignals,
  config: BotConfig,
): Verdict {
  // Honeypot is the strongest signal — check it first.
  if (signals.honeypot && signals.honeypot.trim() !== "") {
    return { human: false, reason: "honeypot" };
  }

  if (!EMAIL_RE.test(signals.email.trim())) {
    return { human: false, reason: "invalid_email" };
  }

  // Only enforce the timing floor when we actually measured elapsed time.
  if (
    typeof signals.elapsedMs === "number" &&
    signals.elapsedMs < config.minElapsedMs
  ) {
    return { human: false, reason: "too_fast" };
  }

  return { human: true };
}
