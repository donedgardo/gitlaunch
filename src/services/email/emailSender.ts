export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

// Abstraction over transactional email delivery. Routes depend on this
// interface, not a concrete provider, so dev/tests can use the console fake and
// production can use Resend (or any future adapter) without code changes.
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

// Dev/test sender: logs the message (including the confirmation link) instead
// of hitting a real provider. Keeps a record of sent messages for assertions.
export class ConsoleEmailSender implements EmailSender {
  public readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    console.info(
      `[email] To: ${message.to} | Subject: ${message.subject}\n${message.text ?? message.html}`,
    );
  }
}

export type ResendConfig = {
  apiKey: string;
  from: string;
};

// Production sender backed by Resend's REST API. No SDK dependency — a single
// fetch keeps the footprint small. A fetch impl can be injected for testing.
export class ResendEmailSender implements EmailSender {
  private apiKey: string;
  private from: string;
  private fetchImpl: typeof fetch;

  constructor(config: ResendConfig, fetchImpl: typeof fetch = fetch) {
    this.apiKey = config.apiKey;
    this.from = config.from;
    this.fetchImpl = fetchImpl;
  }

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Resend email failed (${response.status}): ${body || "unknown error"}`,
      );
    }
  }
}

// Picks the sender from the environment: Resend when RESEND_API_KEY + EMAIL_FROM
// are set, otherwise the console fake. This lets the feature ship and run before
// the sending domain is verified — flip it on by adding the env vars.
export function createEmailSender(
  env: NodeJS.ProcessEnv = process.env,
): EmailSender {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (apiKey && from) {
    return new ResendEmailSender({ apiKey, from });
  }
  console.info(
    "Email: RESEND_API_KEY/EMAIL_FROM not set — using console email sender (no real emails sent).",
  );
  return new ConsoleEmailSender();
}
