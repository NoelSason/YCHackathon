import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildMail } from "../src/app.js";
import { FallbackMailSender, SendRefused, type MailSender } from "../src/outreach/send.js";
import { NaiveMailSender, naiveMailLister, ResendMailSender } from "../src/outreach/alt-mail.js";

const LIMIT = "New account recipient limit exceeded: this organization may email at most 10 distinct recipients.";

function fake(name: string, behavior: "ok" | "limit" | "blocked" = "ok") {
  const calls: string[] = [];
  const replies: string[] = [];
  const sender: MailSender = {
    async send(a) {
      calls.push(a.to);
      if (behavior === "limit") throw new SendRefused(LIMIT, 429);
      if (behavior === "blocked") throw new SendRefused("recipient is on the block list", 403);
      return { messageId: `${name}-1`, from: `${name}@x.example` };
    },
    async reply(a) {
      replies.push(a.messageId);
      return { messageId: `${name}-r` };
    },
  };
  return { sender, calls, replies };
}
const mail = { to: "hello@studio.example", subject: "s", text: "t", idempotencyKey: "abc" };

describe("the send fallback", () => {
  it("uses the main inbox when it accepts, and never the alternative", async () => {
    const a = fake("main"), b = fake("alt");
    const res = await new FallbackMailSender(a.sender, b.sender).send(mail);
    expect(res.messageId).toBe("main-1");
    expect(b.calls).toEqual([]);
  });

  it("sends the same email from the alternative when the main inbox hits its limit", async () => {
    const a = fake("main", "limit"), b = fake("alt");
    const res = await new FallbackMailSender(a.sender, b.sender).send(mail);
    expect(res).toEqual({ messageId: "alt-1", from: "alt@x.example" });
    expect(b.calls).toEqual(["hello@studio.example"]);
  });

  it("doesn't retry an address the main inbox refused for another reason", async () => {
    const a = fake("main", "blocked"), b = fake("alt");
    await expect(new FallbackMailSender(a.sender, b.sender).send(mail)).rejects.toThrow(/block list/);
    expect(b.calls).toEqual([]);
  });

  it("answers a message from the inbox it arrived at", async () => {
    const a = fake("main"), b = fake("alt");
    const s = new FallbackMailSender(a.sender, b.sender);
    await s.reply({ messageId: "inb_123", text: "t", idempotencyKey: "k" });
    await s.reply({ messageId: "<abc@agentmail.to>", text: "t", idempotencyKey: "k2" });
    expect(b.replies).toEqual(["inb_123"]);
    expect(a.replies).toEqual(["<abc@agentmail.to>"]);
  });
});

describe("choosing the alternative", () => {
  const base = { AGENTMAIL_API_KEY: "am", AGENTMAIL_INBOX_ID: "levelai@agentmail.to" };
  const naive = { NAIVE_API_KEY_SOCIAL: "n", NAIVE_SOCIAL_IDENTITY_ID: "idn_1", NAIVE_SALES_INBOX_ID: "eml_1", NAIVE_SALES_INBOX_ADDRESS: "a@b.example" };
  const resend = { RESEND_API_KEY: "r", RESEND_FROM: "Level AI <a@levelai.example>" };
  const alt = (m: MailSender | null) => (m as unknown as { alternative: unknown }).alternative;

  it("stays on the main inbox alone with no alternative configured, so a limit stays a refusal", () => {
    expect(buildMail(loadConfig(base))).not.toBeInstanceOf(FallbackMailSender);
  });
  it("prefers the Naïve inbox over Resend", () => {
    expect(alt(buildMail(loadConfig({ ...base, ...naive, ...resend })))).toBeInstanceOf(NaiveMailSender);
  });
  it("falls back to Resend when only Resend is configured", () => {
    expect(alt(buildMail(loadConfig({ ...base, ...resend })))).toBeInstanceOf(ResendMailSender);
  });
});

describe("NaiveMailSender", () => {
  const o = { apiKey: "k", baseUrl: "https://api.example", identityId: "idn_1", inboxId: "eml_1", address: "levelai@x.example" };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("posts only the documented fields, with the idempotency key", async () => {
    const seen: Array<{ url: string; body: unknown; key: string | null }> = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get("idempotency-key") });
      return json(202, { accepted: true });
    }) as unknown as typeof fetch;
    const res = await new NaiveMailSender({ ...o, fetchImpl: f }).send({ ...mail, html: "<b>x</b>" });
    expect(res.from).toBe("levelai@x.example");
    expect(seen[0]).toEqual({ url: "https://api.example/v1/identities/idn_1/emails/eml_1/send", body: { to: ["hello@studio.example"], subject: "s", text: "t" }, key: "abc" });
  });

  it("retries a capacity error with the same key", async () => {
    const keys: Array<string | null> = [];
    const f = (async (_u: string, init: RequestInit) => {
      keys.push(new Headers(init.headers).get("idempotency-key"));
      return keys.length === 1 ? json(429, { error: { message: "the service is at capacity" } }) : json(202, {});
    }) as unknown as typeof fetch;
    await new NaiveMailSender({ ...o, fetchImpl: f }).send(mail);
    expect(keys).toEqual(["abc", "abc"]);
  });

  it("reports a refusal without retrying", async () => {
    let n = 0;
    const f = (async () => { n++; return json(402, { error: { message: "insufficient credits" } }); }) as unknown as typeof fetch;
    await expect(new NaiveMailSender({ ...o, fetchImpl: f }).send(mail)).rejects.toMatchObject({ status: 402 });
    expect(n).toBe(1);
  });

  it("answers an inbound message by sending to its sender with Re: on the subject", async () => {
    let body: { to: string[]; subject: string } | null = null;
    const f = (async (url: string, init?: RequestInit) => {
      if (url.includes("/messages")) return json(200, { data: [{ id: "inb_1", from: "hello@studio.example", subject: "Levels", text: "yes" }] });
      body = JSON.parse(String(init?.body));
      return json(202, {});
    }) as unknown as typeof fetch;
    await new NaiveMailSender({ ...o, fetchImpl: f }).reply({ messageId: "inb_1", text: "t", idempotencyKey: "k" });
    expect(body).toMatchObject({ to: ["hello@studio.example"], subject: "Re: Levels" });
  });

  it("lists inbound mail in the shape the inbox poll expects", async () => {
    const f = (async () => json(200, { data: [{ id: "inb_1", from: "a@b.example", subject: null, text: "yes", received_at: "2026-11-08T07:00:00Z" }] })) as unknown as typeof fetch;
    expect(await naiveMailLister(o, f)()).toEqual([{ messageId: "inb_1", from: "a@b.example", subject: "", text: "yes", threadId: null, labels: ["received"], at: "2026-11-08T07:00:00Z" }]);
  });
});

describe("ResendMailSender", () => {
  it("sends with Reply-To the main inbox and the idempotency key", async () => {
    let sent: { reply_to?: string; from?: string } = {};
    let key: string | null = null;
    const f = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      key = new Headers(init.headers).get("idempotency-key");
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await new ResendMailSender({ apiKey: "r", from: "Level AI <a@x.example>", replyTo: "levelai@agentmail.to", fetchImpl: f }).send(mail);
    expect(res.messageId).toBe("re_1");
    expect(sent.reply_to).toBe("levelai@agentmail.to");
    expect(key).toBe("abc");
  });
});
