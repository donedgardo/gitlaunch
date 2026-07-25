import { describe, it, expect } from "vitest";
import {
  ConsoleEmailSender,
  ResendEmailSender,
  createEmailSender,
} from "./emailSender";

describe("ConsoleEmailSender", () => {
  it("should record sent messages instead of delivering them", async () => {
    const sender = new ConsoleEmailSender();

    await sender.send({
      to: "user@example.com",
      subject: "Hi",
      html: "<p>Hi</p>",
    });

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe("user@example.com");
  });
});

describe("ResendEmailSender", () => {
  it("should POST the message to the Resend API with auth", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const fakeFetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const sender = new ResendEmailSender(
      { apiKey: "re_test", from: "GitLaunch <noreply@gitlaunch.dev>" },
      fakeFetch,
    );

    await sender.send({
      to: "person@example.com",
      subject: "Confirm your email",
      html: "<a>link</a>",
      text: "link",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(calls[0].init.body);
    expect(body.to).toBe("person@example.com");
    expect(body.from).toBe("GitLaunch <noreply@gitlaunch.dev>");
    expect(body.subject).toBe("Confirm your email");
  });

  it("should throw when Resend returns an error status", async () => {
    const fakeFetch = (async () =>
      new Response("bad", { status: 422 })) as unknown as typeof fetch;
    const sender = new ResendEmailSender({ apiKey: "k", from: "f" }, fakeFetch);

    await expect(
      sender.send({ to: "x@y.com", subject: "s", html: "h" }),
    ).rejects.toThrow(/Resend email failed/);
  });
});

describe("createEmailSender", () => {
  it("should return the console sender when Resend env is absent", () => {
    const sender = createEmailSender({} as NodeJS.ProcessEnv);
    expect(sender).toBeInstanceOf(ConsoleEmailSender);
  });

  it("should return the Resend sender when env is configured", () => {
    const sender = createEmailSender({
      RESEND_API_KEY: "re_x",
      EMAIL_FROM: "a@b.com",
    } as NodeJS.ProcessEnv);
    expect(sender).toBeInstanceOf(ResendEmailSender);
  });
});
