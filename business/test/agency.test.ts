import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import type { ToolContext } from "../src/mcp/tools.js";
import type { MonidRunner } from "../src/research/monid.js";
import { checkOutreach } from "../src/outreach/guard.js";
import { handleInboundReply, setReplyResponder, type InboundReply } from "../src/outreach/inbound.js";
import { MemoryAgencyStore } from "../src/agency/store.js";
import { buildFacts } from "../src/agency/facts.js";
import { isAgencyRoleAddress, parseClutchProfile, parseSite, pickAgencyAddress } from "../src/agency/discover.js";
import { acceptableAbout, agencyEmailsSince, composeAgencyEmail, runAgencyCycle } from "../src/agency/outreach.js";
import { checkAgentText, converse, handoffReason, linkFromTheirText, type Decider, type Decision } from "../src/agency/converse.js";
import { agencyResponder, registerAgency, TEST_AGENCY } from "../src/agency/index.js";

// Agency outreach and the conversational sales agent, with fake mail, Monid, sites, and model. No network.
const ADDRESS = "1752 Shattuck Avenue, Berkeley, CA 94704";
const TEAM = "noel_sason@berkeley.edu";

interface Sent { to: string; subject: string; text: string; idempotencyKey: string }
interface Replied { messageId: string; text: string; idempotencyKey: string }

function setup(env: Record<string, string> = {}) {
  const sent: Sent[] = [];
  const replies: Replied[] = [];
  const store = new MemoryStore();
  const ctx: ToolContext = {
    config: loadConfig({ COMPANY_POSTAL_ADDRESS: ADDRESS, OUTREACH_SEND: "1", PLAYTEST_PRICE_USD: "5", TEAM_EMAILS: `${TEAM},other@example.com`, BUSINESS_MCP_TOKEN: "tok", ...env }),
    store, monid: null, naive: null, mobilerun: null, stripe: null,
    mail: {
      async send(a) { sent.push(a); return { messageId: `<out${sent.length}@agentmail.to>` }; },
      async reply(a) { replies.push(a); return { messageId: `<re${replies.length}@agentmail.to>` }; },
    },
  };
  return { ctx, store, sent, replies, agencies: new MemoryAgencyStore() };
}

const sender = { name: "Noel Sason", company: "Level AI", postalAddress: ADDRESS, site: "https://levelai.vercel.app" };
let n = 0;
const msg = (from: string, text: string, subject = "Re: A free 5-level puzzle sample"): InboundReply => {
  n += 1;
  return { eventId: `<in${n}@mail.example>`, from, subject, text, threadId: "t1", messageId: `<in${n}@mail.example>` };
};
const decision = (over: Partial<Decision> = {}): Decision => ({
  action: "answer", reply: "Hi Pixel Forge team,\n\nThanks for asking. The level pack is $49 for 20 levels, delivered within 48 hours.", topic: "answered a pricing question",
  handoff_reason: "", product: "none", genre: "none", difficulty: "none", game_url: "", ...over,
});
const fixed = (...ds: Decision[]): Decider & { calls: number } => {
  const state = { calls: 0 };
  const f: Decider = async () => {
    state.calls++;
    return { ok: true, decision: ds[Math.min(state.calls - 1, ds.length - 1)]! };
  };
  return Object.defineProperty(f, "calls", { get: () => state.calls }) as Decider & { calls: number };
};

async function agencyLead(s: ReturnType<typeof setup>, stage: "emailed" | "replied" = "replied") {
  const lead = await s.store.upsertLead({ company: "Pixel Forge", appId: null, contactName: null, email: "hello@pixelforge.example", source: "manual", stage, reason: "Game-development agency on Clutch.", sampleUrl: null, crmContactId: null });
  await s.agencies.save({ leadId: lead.id, slug: "pixel-forge", domain: "pixelforge.example", company: "Pixel Forge", about: "builds mobile games for clients", services: null, website: "https://pixelforge.example", contactEmail: lead.email, internalTest: false, status: "emailed", detail: null });
  return lead;
}

describe("agency email", () => {
  it("is specific, honest, and passes the outreach guard", async () => {
    const s = setup();
    const draft = composeAgencyEmail({ company: "Pixel Forge", about: "builds mobile games and game art for client studios", services: [], sender, genres: ["match-3", "water-sort"] });
    expect(draft.body).toContain("I found Pixel Forge in Clutch's game development directory. From your site, it looks like your team builds mobile games and game art for client studios.");
    expect(draft.body).toContain("free: we'll build and bot-test a 5-level sample for one of your clients' puzzle games, or run an iPhone playtest of any build");
    expect(draft.body).toContain(ADDRESS);
    expect(draft.body).toContain(`Reply "stop"`);
    const lead = await s.store.upsertLead({ company: "Pixel Forge", appId: null, contactName: null, email: "hello@pixelforge.example", source: "manual", stage: "found", reason: null, sampleUrl: null, crmContactId: null });
    expect(await checkOutreach(lead, draft, { store: s.store, dailyCap: 40, postalAddress: ADDRESS, extraAllowedNumbers: [ADDRESS] })).toBeNull();
    // An invented number in the body is caught by the same guard.
    const padded = { ...draft, body: draft.body.replace("Clutch's", "Clutch's 300-studio") };
    expect(await checkOutreach(lead, padded, { store: s.store, dailyCap: 40, postalAddress: ADDRESS, extraAllowedNumbers: [ADDRESS] })).toMatch(/numbers with no source: 300/);
  });

  it("only uses a 'what they do' line with no numbers or praise", () => {
    expect(acceptableAbout("builds mobile games and game art for clients")).toBe("builds mobile games and game art for clients");
    expect(acceptableAbout("has shipped 500 games")).toBeNull();
    expect(acceptableAbout("is the leading game studio in Europe")).toBeNull();
    expect(acceptableAbout("")).toBeNull();
  });
});

describe("role-based addresses only", () => {
  it.each([
    ["hello@pixelforge.example", true], ["contact@pixelforge.example", true], ["info@pixelforge.example", true],
    ["business@pixelforge.example", true], ["partnerships@pixelforge.example", true],
    ["jane@pixelforge.example", false], ["jane.doe@pixelforge.example", false], ["support@pixelforge.example", false], ["careers@pixelforge.example", false],
  ])("%s → %s", (email, ok) => expect(isAgencyRoleAddress(email)).toBe(ok));

  it("picks the best role address on their own domain", () => {
    expect(pickAgencyAddress(["ceo.name@pixelforge.example", "info@pixelforge.example", "business@pixelforge.example", "hello@gmail.com"], "pixelforge.example")).toBe("business@pixelforge.example");
    expect(pickAgencyAddress(["anna@pixelforge.example", "hello@other.example"], "pixelforge.example")).toBeNull();
  });

  it("reads a site's title, description, and mailto links", () => {
    const site = parseSite(`<html><head><title>Pixel Forge &amp; Co</title><meta name="description" content="Mobile game development for studios"></head><body><a href="mailto:hello@pixelforge.example?subject=hi">Mail</a></body></html>`);
    expect(site).toMatchObject({ title: "Pixel Forge & Co", description: "Mobile game development for studios" });
    expect(site.emails).toContain("hello@pixelforge.example");
    expect(parseClutchProfile({ data: { name: "X", website_url: "https://x.example/?utm_source=clutch.co&utm_medium=referral", service_lines: [{ service: "Game Development" }] } })?.website).toBe("https://x.example/");
  });
});

describe("agency outreach cycle", () => {
  const html = (title: string, email: string) => `<title>${title}</title><meta name="description" content="${title}"><a href="mailto:${email}">x</a>`;
  function world() {
    const calls: string[] = [];
    const monid: MonidRunner = {
      async run(a) {
        calls.push(`${a.provider}${a.endpoint}`);
        const q = a.query as { slug?: string; page?: number } | undefined;
        if (a.endpoint === "/search_companies") return { data: { companies: q?.page === 0 ? [{ name: "Accounting Pros", slug: "acct" }, { name: "Pixel Forge Games", slug: "pixel" }, { name: "Known Games", slug: "known" }] : [] } };
        if (a.endpoint === "/get_company_profile") {
          const site = { acct: "https://acct.example", pixel: "https://pixelforge.example", known: "https://known.example" }[q!.slug as "acct"];
          return { data: { name: q!.slug, website_url: site, service_lines: [] } };
        }
        if (a.endpoint === "/domain-search") return { data: { emails: [] } };
        throw new Error("unexpected");
      },
    };
    const fetchImpl = (async (u: string | URL | Request) => {
      const url = String(u);
      const body = url.includes("pixelforge") ? html("Pixel Forge: mobile game development", "hello@pixelforge.example")
        : url.includes("known") ? html("Known: game art", "info@known.example") : html("Accounting Pros: bookkeeping", "info@acct.example");
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    return { monid, fetchImpl, calls };
  }

  it("emails a game agency, skips one that doesn't make games, and dedupes a known domain", async () => {
    const s = setup();
    await s.store.upsertLead({ company: "Someone", appId: null, contactName: null, email: "info@known.example", source: "research", stage: "emailed", reason: null, sampleUrl: null, crmContactId: null });
    const w = world();
    const r = await runAgencyCycle({ ...s.ctx, monid: w.monid }, { agencies: s.agencies, monid: w.monid, fetchImpl: w.fetchImpl, cache: false }, { perRun: 3, maxPages: 2 });
    expect(r.emailed).toEqual([{ company: "Pixel Forge Games", domain: "pixelforge.example" }]);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.to).toBe("hello@pixelforge.example");
    const acts = (await s.store.listActivity(100)).map((a) => a.action);
    expect(acts).toContain("found agency Pixel Forge Games");
    expect(acts).toContain("emailed agency Pixel Forge Games (pixelforge.example)");
    expect(acts).toContain("skipped agency Accounting Pros");
    expect((await s.agencies.bySlug("known"))?.detail).toMatch(/already in our CRM/);
    // A second pass doesn't pay for the same agencies again.
    const before = w.calls.filter((c) => c.endsWith("/get_company_profile")).length;
    await runAgencyCycle({ ...s.ctx, monid: w.monid }, { agencies: s.agencies, monid: w.monid, fetchImpl: w.fetchImpl, cache: false }, { perRun: 3, maxPages: 1 });
    expect(w.calls.filter((c) => c.endsWith("/get_company_profile")).length).toBe(before);
    expect(s.sent).toHaveLength(1);
  });

  it("stops at the daily cap", async () => {
    const s = setup();
    for (let i = 0; i < 2; i++) await s.store.logActivity({ at: new Date().toISOString(), agent: "agency-sales", action: `emailed agency A${i} (a${i}.example)`, why: null, result: null, costUsd: null, human: false });
    expect(await agencyEmailsSince(s.ctx, new Date(Date.now() - 3600_000).toISOString())).toBe(2);
    const w = world();
    const r = await runAgencyCycle({ ...s.ctx, monid: w.monid }, { agencies: s.agencies, monid: w.monid, fetchImpl: w.fetchImpl, cache: false }, { cap: 2 });
    expect(r).toMatchObject({ sent: 0, reason: "daily cap" });
    expect(w.calls).toHaveLength(0);
    expect(s.sent).toHaveLength(0);
  });
});

describe("conversational sales agent", () => {
  it("answers from the facts in the same thread, once per message", async () => {
    const s = setup();
    const lead = await agencyLead(s);
    const m = msg("hello@pixelforge.example", "How much is a pack of levels, and how fast?");
    const decide = fixed(decision());
    expect(await converse(s.ctx, { agencies: s.agencies, decide, startWork: false }, { leadId: lead.id, reply: m })).toBe(true);
    expect(s.replies).toHaveLength(1);
    expect(s.replies[0]!.messageId).toBe(m.messageId); // threaded on their message
    expect(s.replies[0]!.text).toContain("$49 for 20 levels");
    expect(s.replies[0]!.text).toContain(`Reply "stop"`);
    expect((await s.store.listActivity(20)).map((a) => a.action)).toContain("replied to Pixel Forge: answered a pricing question");
    // The same message again (webhook and poll both saw it): no second answer, no second model call.
    expect(await converse(s.ctx, { agencies: s.agencies, decide, startWork: false }, { leadId: lead.id, reply: m })).toBe(true);
    expect(s.replies).toHaveLength(1);
    expect(decide.calls).toBe(1);
  });

  it("rejects an invented number, retries once, and hands off if it's still wrong", async () => {
    const s = setup();
    const lead = await agencyLead(s);
    const invented = decision({ reply: "Hi Pixel Forge team, we can do 30 levels for $29, and 12 studios already use us." });
    expect(checkAgentText(invented.reply, buildFacts(s.ctx.config, { stripe: false }))).toMatch(/30, 29, 12/);
    const decide = fixed(invented, invented);
    expect(await converse(s.ctx, { agencies: s.agencies, decide, startWork: false }, { leadId: lead.id, reply: msg(lead.email!, "Can you do a bigger pack cheaper?") })).toBe(false);
    expect(decide.calls).toBe(2);
    expect(s.replies).toHaveLength(0);
    expect((await s.store.listActivity(20)).some((a) => a.action === "step-in needed: reply from Pixel Forge")).toBe(true);
    // A clean rewrite on the retry is sent.
    const decide2 = fixed(invented, decision());
    expect(await converse(s.ctx, { agencies: s.agencies, decide: decide2, startWork: false }, { leadId: lead.id, reply: msg(lead.email!, "What does it cost?") })).toBe(true);
    expect(s.replies).toHaveLength(1);
  });

  it("refuses links off our site and other-customer talk", () => {
    const facts = buildFacts(loadConfig({ COMPANY_POSTAL_ADDRESS: ADDRESS }), { stripe: false });
    expect(checkAgentText("Hi team, see https://evil.example/pay for the details of the offer.", facts)).toMatch(/other than our site/);
    expect(checkAgentText("Hi team, our clients include several big studios, so you're in good hands.", facts)).toMatch(/other customers/);
    expect(checkAgentText(`Hi team, our levels are at ${facts.links.games} if you'd like to play some.`, facts)).toBeNull();
  });

  it.each([
    ["This is spam. How did you get my email?", /upset|how we got/],
    ["Please send me your contract and NDA first.", /contract/],
    ["Our lawyer will be in touch.", /lawyer|upset/],
  ])("hands off without a model call: %s", async (text, why) => {
    const s = setup();
    const lead = await agencyLead(s);
    const decide = fixed(decision());
    expect(await converse(s.ctx, { agencies: s.agencies, decide, startWork: false }, { leadId: lead.id, reply: msg(lead.email!, text) })).toBe(false);
    expect(decide.calls).toBe(0);
    expect(s.replies).toHaveLength(0);
    const step = (await s.store.listActivity(20)).find((a) => a.action.startsWith("step-in needed"));
    expect(step?.why).toMatch(why);
  });

  it("hands off after six exchanges", async () => {
    const s = setup();
    const lead = await agencyLead(s);
    const decide = fixed(decision());
    for (let i = 0; i < 6; i++) {
      expect(await converse(s.ctx, { agencies: s.agencies, decide, startWork: false }, { leadId: lead.id, reply: msg(lead.email!, `Question number ${"again ".repeat(i)}about pricing?`) })).toBe(true);
    }
    expect(await converse(s.ctx, { agencies: s.agencies, decide, startWork: false }, { leadId: lead.id, reply: msg(lead.email!, "One more question?") })).toBe(false);
    expect(s.replies).toHaveLength(6);
    expect(handoffReason("Re:", "hi there", 6)).toMatch(/6 exchanges/);
  });

  it("never answers after stop", async () => {
    const s = setup();
    const lead = await agencyLead(s, "emailed");
    const decide = fixed(decision());
    setReplyResponder(agencyResponder(s.ctx, { agencies: s.agencies, decide, startWork: false }));
    try {
      const out = await handleInboundReply(msg(lead.email!, "stop"), s.store);
      expect(out.kind).toBe("opted_out");
      expect(await converse(s.ctx, { agencies: s.agencies, decide, startWork: false }, { leadId: lead.id, reply: msg(lead.email!, "What does it cost?") })).toBe(true);
      expect(decide.calls).toBe(0);
      expect(s.replies).toHaveLength(0);
    } finally {
      setReplyResponder(null);
    }
  });

  it("starts the free sample only with a genre, and only once", async () => {
    const s = setup();
    const queries: string[] = [];
    s.ctx.db = async (text) => { queries.push(text); return []; };
    const lead = await agencyLead(s);
    const sample = decision({ action: "send_free_sample", reply: "Hi Pixel Forge team, happy to start the free sample for your client's game.", topic: "started the free sample", genre: "watersort", difficulty: "easy" });
    expect(await converse(s.ctx, { agencies: s.agencies, decide: fixed(decision({ ...sample, genre: "none" })), startWork: false }, { leadId: lead.id, reply: msg(lead.email!, "Yes, send the free sample please") })).toBe(true);
    expect(s.replies.at(-1)!.text).toMatch(/Which genre fits the game/);
    expect(await converse(s.ctx, { agencies: s.agencies, decide: fixed(sample), startWork: false }, { leadId: lead.id, reply: msg(lead.email!, "Water sort, easy") })).toBe(true);
    expect(s.replies.at(-1)!.text).toContain("Your free 5-level water-sort sample (easy) has started.");
    expect(await converse(s.ctx, { agencies: s.agencies, decide: fixed(sample), startWork: false }, { leadId: lead.id, reply: msg(lead.email!, "Can we get another one?") })).toBe(true);
    expect(s.replies.at(-1)!.text).toMatch(/already started earlier/);
  });

  it("only uses a game link that's in their own message", () => {
    expect(linkFromTheirText("https://apps.apple.com/app/id123", "Here: https://apps.apple.com/app/id123.")).toBe("https://apps.apple.com/app/id123");
    expect(linkFromTheirText("https://apps.apple.com/app/id999", "Here: https://apps.apple.com/app/id123")).toBeNull();
  });
});

describe("POST /agency/demo-start", () => {
  const post = (body: unknown, auth = "Bearer tok") => new Request("http://x/agency/demo-start", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });

  it("needs the bearer and a team address, then emails the test agency and answers its reply in-thread", async () => {
    const s = setup();
    const route = registerAgency(s.ctx, s.ctx.config);
    try {
      expect((await route(post({}, "Bearer nope"), new URL("http://x/agency/demo-start")))!.status).toBe(401);
      expect((await route(post({ email: "stranger@example.com" }), new URL("http://x/agency/demo-start")))!.status).toBe(400);
      expect(await route(post({}), new URL("http://x/other"))).toBeNull();
      const res = await route(post({ email: TEAM }), new URL("http://x/agency/demo-start"));
      expect(res!.status).toBe(202);
      expect(await res!.json()).toMatchObject({ ok: true, status: "sent" });
      expect(s.sent).toHaveLength(1);
      expect(s.sent[0]!.to).toBe(TEAM);
      const lead = (await s.store.findLeadByEmail(TEAM))!;
      expect(lead.company).toBe(TEST_AGENCY);
      expect((await s.store.listActivity(20)).map((a) => a.action)).toContain(`emailed the test agency: ${TEST_AGENCY}`);
      // A second run starts a fresh conversation and a fresh email.
      expect((await route(post({ email: TEAM }), new URL("http://x/agency/demo-start")))!.status).toBe(202);
      expect(s.sent).toHaveLength(2);
      expect(s.sent[1]!.idempotencyKey).not.toBe(s.sent[0]!.idempotencyKey);

      // Noel replies like a prospect; the agent answers in the thread.
      const { agencyStore } = await import("../src/agency/index.js");
      setReplyResponder(agencyResponder(s.ctx, { agencies: agencyStore(s.ctx), decide: fixed(decision({ reply: `Hi ${TEST_AGENCY} team, the level pack is $49 for 20 levels.` })), startWork: false }));
      const m = msg(TEAM, "Interesting. What would a pack cost for a client's match-3 game?");
      const out = await handleInboundReply(m, s.store);
      expect(out.kind).toBe("auto_answered");
      expect(s.replies).toHaveLength(1);
      expect(s.replies[0]!.messageId).toBe(m.messageId);
      expect((await s.store.listActivity(30)).map((a) => a.action)).toContain(`replied to ${TEST_AGENCY} (test agency): answered a pricing question`);
    } finally {
      setReplyResponder(null);
    }
  });
});

// ---------- tonight's constraints: the provider's new-recipient limit, and prospects who write first ----------

import { SendRefused } from "../src/outreach/send.js";
import { providerLimitUntil, sendPausedUntil, setSendPause } from "../src/agency/outreach.js";
import { prepareProspect, prospectKind, withProspects } from "../src/agency/prospect.js";
import { pollOnce, type PolledMessage } from "../src/outreach/poll.js";

const LIMIT = "New account recipient limit exceeded: this organization may email at most 10 distinct recipients in its first 24 hours (25 in its first week). The limit rises to 25 at 2026-11-08T23:04:31.356Z and lifts after a week.";

describe("email provider limit", () => {
  it("reads the reopen time from the provider's message", () => {
    const now = new Date("2026-11-08T05:30:00Z");
    expect(providerLimitUntil(new SendRefused(LIMIT, 429), now)?.toISOString()).toBe("2026-11-08T23:04:31.356Z");
    expect(providerLimitUntil(new SendRefused("Sending limit exceeded", 403), now)?.getTime()).toBe(now.getTime() + 3600_000);
    expect(providerLimitUntil(new Error("network error"), now)).toBeNull();
  });

  it("pauses agency email, skips paid lookups while paused, and retries the pending agency afterwards", async () => {
    const s = setup();
    let refuse = true;
    s.ctx.mail = {
      async send(a) { if (refuse) throw new SendRefused(LIMIT, 429); s.sent.push(a); return { messageId: "<ok@agentmail.to>" }; },
      async reply(a) { s.replies.push(a); return { messageId: "<re@agentmail.to>" }; },
    };
    const calls: string[] = [];
    const monid: MonidRunner = {
      async run(a) {
        calls.push(a.endpoint);
        if (a.endpoint === "/search_companies") return { data: { companies: [{ name: "Pixel Forge Games", slug: "pixel" }] } };
        if (a.endpoint === "/get_company_profile") return { data: { name: "Pixel Forge Games", website_url: "https://pixelforge.example", service_lines: [{ service: "Game Development" }] } };
        return { data: { emails: [] } };
      },
    };
    const fetchImpl = (async () => new Response(`<title>Pixel Forge: mobile games</title><a href="mailto:hello@pixelforge.example">x</a>`, { headers: { "content-type": "text/html" } })) as typeof fetch;
    const now = new Date("2026-11-08T05:30:00Z");
    try {
      const r1 = await runAgencyCycle({ ...s.ctx, monid }, { agencies: s.agencies, monid, fetchImpl, cache: false, now });
      expect(r1.reason).toBe("email provider limit");
      expect(sendPausedUntil(now)?.toISOString()).toBe("2026-11-08T23:04:31.356Z");
      const acts = (await s.store.listActivity(50)).map((a) => a.action);
      expect(acts.some((a) => /^email provider limit reached; paused until Sun 3:04 PM PT$/.test(a))).toBe(true);
      // While paused: no lookups, no money spent, no send attempts.
      const before = calls.length;
      const r2 = await runAgencyCycle({ ...s.ctx, monid }, { agencies: s.agencies, monid, fetchImpl, cache: false, now: new Date("2026-11-08T12:00:00Z") });
      expect(r2.reason).toBe("email provider limit");
      expect(calls.length).toBe(before);
      // The pause is said once (by the refused send), not again on each pass while paused.
      await runAgencyCycle({ ...s.ctx, monid }, { agencies: s.agencies, monid, fetchImpl, cache: false, now: new Date("2026-11-08T14:00:00Z") });
      const pauseRows = (await s.store.listActivity(200)).filter((a) => /paused until Sun 3:04 PM PT$/.test(a.action));
      expect(pauseRows).toHaveLength(1);
      // After the reopen time, the agency already found is emailed without buying its profile again.
      refuse = false;
      const later = new Date("2026-11-08T23:10:00Z");
      const profiles = calls.filter((c) => c === "/get_company_profile").length;
      const r3 = await runAgencyCycle({ ...s.ctx, monid }, { agencies: s.agencies, monid, fetchImpl, cache: false, now: later }, { perRun: 1 });
      expect(r3.emailed).toEqual([{ company: "Pixel Forge Games", domain: "pixelforge.example" }]);
      expect(s.sent).toHaveLength(1);
      expect(calls.filter((c) => c === "/get_company_profile").length).toBe(profiles);
    } finally {
      setSendPause(null, false);
    }
  });

  it("demo-start falls back to waiting for the agency to write in", async () => {
    const s = setup();
    s.ctx.mail = { async send() { throw new SendRefused(LIMIT, 429); }, async reply(a) { s.replies.push(a); return { messageId: "<re@agentmail.to>" }; } };
    const route = registerAgency(s.ctx, s.ctx.config);
    try {
      const res = await route(new Request("http://x/agency/demo-start", { method: "POST", headers: { authorization: "Bearer tok" }, body: JSON.stringify({ email: TEAM }) }), new URL("http://x/agency/demo-start"));
      expect(res!.status).toBe(202);
      expect(await res!.json()).toMatchObject({ ok: true, status: "waiting_for_inbound" });
      const lead = (await s.store.findLeadByEmail(TEAM))!;
      expect(lead).toMatchObject({ company: TEST_AGENCY, stage: "emailed" });
    } finally {
      setSendPause(null, false);
      setReplyResponder(null);
    }
  });
});

describe("prospects who write to us first", () => {
  const polled = (from: string, subject: string, text: string, id = `<p${++n}@mail.example>`): PolledMessage => ({ messageId: id, from, subject, text, threadId: "t9", labels: ["received"] });
  const team = [TEAM];

  it.each([
    [`Noel <${TEAM}>`, "Agency inquiry", "Hi, we're a small agency.", false, "test_agency"],
    [TEAM, "Re: Agency inquiry", "thanks", false, null],
    [TEAM, "Lunch?", "food", false, null],
    ["Ana <hello@pixelforge.example>", "Puzzle levels for a client", "Do you make levels for match-3 games?", false, "new_prospect"],
    ["noreply@stripe.example", "Your receipt", "pricing", false, null],
    ["hello@pixelforge.example", "Puzzle levels", "levels?", true, null],
    ["someone@example.com", "Hello", "Are you free for coffee?", false, null],
  ])("%s / %s → %s", (from, subject, text, known, kind) => {
    expect(prospectKind({ from, subject, text }, team, known)).toBe(kind);
  });

  it("Noel writes in as the agency, and the sales agent answers in that thread", async () => {
    const s = setup();
    // An older team lead under the same address is reused and renamed.
    await s.store.upsertLead({ company: "Level AI live check", appId: null, contactName: null, email: TEAM, source: "manual", stage: "pilot_offered", reason: null, sampleUrl: null, crmContactId: null });
    const decide = fixed(decision({ reply: `Hi ${TEST_AGENCY} team, thanks for writing. We can build a free 5-level sample for one of your clients' puzzle games.`, topic: "answered an agency inquiry" }));
    setReplyResponder(agencyResponder(s.ctx, { agencies: s.agencies, decide, startWork: false }));
    try {
      const m = polled(`Noel Sason <${TEAM}>`, "Agency inquiry", "Hi, we're a small game agency with a few puzzle clients. What could you do for us?");
      const list = withProspects(s.ctx, s.agencies, async () => [m]);
      const out = await pollOnce({ list, store: s.store, ownAddress: "levelai@agentmail.to" });
      expect(out.map((o) => o.kind)).toEqual(["auto_answered"]);
      expect(s.replies).toHaveLength(1);
      expect(s.replies[0]!.messageId).toBe(m.messageId);
      expect(s.sent).toHaveLength(0); // no first email: a reply to someone who wrote in
      const lead = (await s.store.findLeadByEmail(TEAM))!;
      expect(lead.company).toBe(TEST_AGENCY);
      const acts = (await s.store.listActivity(30)).map((a) => a.action);
      expect(acts).toContain(`new prospect wrote in: ${TEST_AGENCY} (test agency)`);
      expect(acts).toContain(`replied to ${TEST_AGENCY} (test agency): answered an agency inquiry`);
      // The next poll sees the same message again: nothing new happens.
      await pollOnce({ list, store: s.store, ownAddress: "levelai@agentmail.to" });
      expect(s.replies).toHaveLength(1);
      expect(await prepareProspect(s.ctx, s.agencies, m)).toBeNull();
    } finally {
      setReplyResponder(null);
    }
  });

  it("a stranger asking about levels becomes a lead and gets an answer", async () => {
    const s = setup();
    setReplyResponder(agencyResponder(s.ctx, { agencies: s.agencies, decide: fixed(decision({ reply: "Hi pixelforge.example team, our level pack is $49 for 20 levels." })), startWork: false }));
    try {
      const m = polled("Ana <ana.k@pixelforge.example>", "Levels for a client", "How much would levels for a match-3 game cost?");
      const out = await pollOnce({ list: withProspects(s.ctx, s.agencies, async () => [m]), store: s.store, ownAddress: "levelai@agentmail.to" });
      expect(out.map((o) => o.kind)).toEqual(["auto_answered"]);
      expect(s.replies[0]!.messageId).toBe(m.messageId);
      expect((await s.store.findLeadByEmail("ana.k@pixelforge.example"))?.company).toBe("pixelforge.example");
    } finally {
      setReplyResponder(null);
    }
  });
});

describe("prospects and email-in audits", () => {
  it("leaves audit requests to the email-in path", () => {
    expect(prospectKind({ from: "ana@pixelforge.example", subject: "Audit: Parking Loop", text: "levels" }, [TEAM], false)).toBeNull();
    expect(prospectKind({ from: TEAM, subject: "Agency inquiry", text: "https://apps.apple.com/us/app/x/id1" }, [TEAM], false)).toBeNull();
  });
});

describe("sign-offs", () => {
  it("drops the model's own sign-off so our action line and signature come last", async () => {
    const { stripSignOff } = await import("../src/agency/converse.js");
    expect(stripSignOff("Hi Noel,\n\nSounds good.\n\nBest,\nLevel AI", "Level AI")).toBe("Hi Noel,\n\nSounds good.");
    expect(stripSignOff("Hi Noel,\n\nSounds good.\n\n— Level AI", "Level AI")).toBe("Hi Noel,\n\nSounds good.");
    expect(stripSignOff("Hi Noel,\n\nLevel AI builds in four genres.", "Level AI")).toBe("Hi Noel,\n\nLevel AI builds in four genres.");
  });
});

describe("agency names", () => {
  it("drops legal suffixes in the greeting and keeps the subject free of possessives", async () => {
    const { shortName } = await import("../src/agency/outreach.js");
    expect(shortName("Whimsy Games Group LTD")).toBe("Whimsy Games Group");
    expect(shortName("Pixel Genesys LLC")).toBe("Pixel Genesys");
    expect(shortName("CMS Games, Inc.")).toBe("CMS Games");
    const d = composeAgencyEmail({ company: "N-iX Games", about: null, services: ["Game Development"], sender, genres: ["match-3"] });
    expect(d.subject).toBe("A free 5-level puzzle sample for one of your clients");
    expect(d.body.startsWith("Hi N-iX Games team,")).toBe(true);
  });
});

describe("a yes from a studio we emailed from research", () => {
  it("goes to the sales agent, which can start the free sample the email offered", async () => {
    const s = setup();
    const lead = await s.store.upsertLead({ company: "Loop Games", appId: "com.loop.game", contactName: null, email: "hello@loop.example", source: "research", stage: "emailed", reason: "5 of the 150 newest reviews ask for more levels.", sampleUrl: null, crmContactId: null });
    const decide = fixed(decision({ reply: "Hi Loop Games team, which genre fits best?" }));
    setReplyResponder(agencyResponder(s.ctx, { agencies: s.agencies, decide, startWork: false }));
    try {
      await handleInboundReply(msg(lead.email!, "yes"), s.store);
      expect(decide.calls).toBe(1);
    } finally {
      setReplyResponder(null);
    }
  });
});
