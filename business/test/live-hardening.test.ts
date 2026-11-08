import { beforeEach, describe, expect, it } from "vitest";
import reviewsSample from "./fixtures/reviews-sample.json" with { type: "json" };
import { loadConfig } from "../src/config.js";
import { MemoryStore, isTeamEmail, mailboxKey } from "../src/store.js";
import { appIdFromStoreUrl, intakeLead } from "../src/leads/intake.js";
import { resetWelcomeCounts, runLiveSignup, setPlaySearch } from "../src/leads/live.js";
import { resetProgress, start, status } from "../src/leads/progress.js";
import { parseAppSearch, titleMatches, type MonidRunArgs } from "../src/research/monid.js";
import { AgentMailSender, SendRefused } from "../src/outreach/send.js";
import type { ToolContext } from "../src/mcp/tools.js";

/**
 * The live "judge becomes a customer" signup under bad conditions: a slow or failing review
 * provider, a refused send, a bare game name, a typo'd link, a repeat signup, and team tests.
 */
type Reply = (args: MonidRunArgs) => Promise<unknown>;

const search = (title: string, appId: string) => ({
  app_highlight: { title, product_id: appId, author: "Loop Games" },
  organic_results: [{ items: [{ title: "Some Other Game", product_id: "com.other.game", author: "Other" }] }],
});

function ctx(reply: Reply, mail?: ToolContext["mail"]) {
  const sent: Array<{ to: string; subject: string; text: string; idempotencyKey: string }> = [];
  const calls: MonidRunArgs[] = [];
  const c: ToolContext = {
    config: loadConfig({ COMPANY_NAME: "Level AI", COMPANY_POSTAL_ADDRESS: "1752 Shattuck Avenue, Berkeley, CA 94704", DEMO_PLAY_URL: "https://levelai.vercel.app/play" }),
    store: new MemoryStore(),
    monid: { run: (args) => { calls.push(args); return reply(args); } },
    mail: mail ?? { async send(a) { sent.push(a); return { messageId: `m${sent.length}` }; }, async reply() { return { messageId: "r" }; } },
    stripe: null, mobilerun: null, naive: null,
  };
  return { c, sent, calls };
}

const form = { name: "Ada Lovelace", email: "ada@studio.example", company: "Loop Games", consent: true };
const link = "https://play.google.com/store/apps/details?id=com.loop.packedloop";
const never = () => new Promise<unknown>(() => undefined);
const noLevels = async () => null;

async function signup(c: ToolContext, extra: Record<string, unknown>, budgetMs?: number) {
  const r = await intakeLead({ ...form, ...extra }, c.store);
  if (!r.ok) throw new Error(r.error);
  start(r.lead.id, "Got it. Starting now");
  const out = await runLiveSignup(c, r.lead, r.game, noLevels, { appId: r.appId, ...(budgetMs ? { researchBudgetMs: budgetMs } : {}) });
  return { out, lead: r.lead, progress: status(r.lead.id) };
}

beforeEach(() => {
  resetProgress();
  resetWelcomeCounts();
  setPlaySearch(async () => null);
});

describe("live signup time budget", () => {
  it("sends the honest welcome without evidence when the review provider hangs", async () => {
    const { c, sent } = ctx(never);
    const t0 = Date.now();
    const { out, progress } = await signup(c, { game: "Parking Loop", storeUrl: link }, 300);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(out).toMatchObject({ audited: false, email: "sent" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Your free levels from Level AI");
    expect(sent[0]!.text).not.toMatch(/reviews/);
    expect(progress.done).toBe(true);
    expect(progress.steps.map((s) => s.text)).toContain("Reading the reviews took too long, so we'll skip that part");
    const acts = await c.store.listActivity();
    expect(acts.map((a) => a.action)).toContain("couldn't read reviews for Parking Loop");
    // The feed's "sent" row says what this email was based on, not an older reason on the lead.
    expect(acts.find((a) => a.action === "outreach sent to Loop Games")?.why).toBe("Signed up for free levels for Parking Loop; this email has no review evidence.");
  });

  it("passes the remaining budget to the provider call, so the CLI is killed on time", async () => {
    const { c, calls } = ctx(async () => [reviewsSample]);
    await signup(c, { game: "Parking Loop", storeUrl: link }, 20_000);
    expect(calls[0]!.timeoutMs).toBeGreaterThan(15_000);
    expect(calls[0]!.timeoutMs).toBeLessThanOrEqual(20_000);
  });

  it("sends the welcome without evidence when the provider fails", async () => {
    const { c, sent } = ctx(async () => { throw new Error("monid down"); });
    const { out, progress } = await signup(c, { game: "Parking Loop", storeUrl: link });
    expect(out).toMatchObject({ audited: false, email: "sent" });
    expect(sent).toHaveLength(1);
    expect(progress.steps.at(-1)).toMatchObject({ text: "Email sent. Check your inbox", state: "done" });
  });

  it("ends the progress quickly and honestly when the email provider refuses the send", async () => {
    const refusing: ToolContext["mail"] = {
      async send() { throw new SendRefused("New account recipient limit exceeded", 429); },
      async reply() { return { messageId: "r" }; },
    };
    const { c } = ctx(async () => [reviewsSample], refusing);
    const { out, progress } = await signup(c, { game: "Parking Loop", storeUrl: link });
    expect(out.email).toBe("blocked");
    expect(progress.done).toBe(true);
    expect(progress.steps.at(-1)!.state).toBe("failed");
    const row = (await c.store.listActivity()).find((a) => a.action.startsWith("couldn't send the welcome email"));
    expect(row?.why).toMatch(/recipient limit/);
  });
});

describe("live signup with a bare game name", () => {
  it("finds the game on Google Play and quotes its own reviews", async () => {
    const { c, sent, calls } = ctx(async (a) => (a.endpoint === "/google-play/apps" ? search("Parking Loop: Car Puzzle", "com.loop.packedloop") : [reviewsSample]));
    const { out, progress } = await signup(c, { game: "parking loop" });
    expect(calls.map((x) => x.endpoint)).toEqual(["/google-play/apps", "/google-play/app-reviews"]);
    expect((calls[1]!.body as { app_id: string }).app_id).toBe("com.loop.packedloop");
    expect(out).toMatchObject({ audited: true, email: "sent", signal: "too_easy" });
    expect(sent[0]!.subject).toBe("What Parking Loop: Car Puzzle's players are saying");
    expect(progress.steps.map((s) => s.text)).toContain("Finding parking loop on Google Play");
    expect((await c.store.listActivity()).map((a) => a.action)).toContain("found Parking Loop: Car Puzzle on Google Play");
  });

  it("never quotes another game: no matching title means no evidence", async () => {
    const { c, sent, calls } = ctx(async () => search("Totally Different", "com.other.x"));
    const { out } = await signup(c, { game: "Parking Loop" });
    expect(calls).toHaveLength(1);
    expect(out).toMatchObject({ audited: false, email: "sent" });
    expect(sent[0]!.subject).toBe("Your free levels from Level AI");
  });

  it("tries the typed name when a typo'd link has no reviews", async () => {
    const { c, sent, calls } = ctx(async (a) => {
      if (a.endpoint === "/google-play/apps") return search("Parking Loop", "com.loop.packedloop");
      return (a.body as { app_id: string }).app_id === "com.loop.packedlooop" ? [{ items: [] }] : [reviewsSample];
    });
    const { out } = await signup(c, { game: "Parking Loop", storeUrl: "https://play.google.com/store/apps/details?id=com.loop.packedlooop" });
    expect(calls.map((x) => x.endpoint)).toEqual(["/google-play/app-reviews", "/google-play/apps", "/google-play/app-reviews"]);
    expect(out).toMatchObject({ audited: true, email: "sent" });
    expect(sent[0]!.text).toMatch(/of them say the levels are too easy/);
  });

  it("never says it read 0 reviews", async () => {
    const { c, sent } = ctx(async () => [{ items: [] }]);
    await signup(c, { storeUrl: link });
    expect(sent[0]!.text).not.toMatch(/\b0 newest/);
    expect(sent[0]!.subject).toBe("Your free levels from Level AI");
  });

  it("lets a number in the game's own name through the honesty check", async () => {
    const { c, sent } = ctx(async (a) => (a.endpoint === "/google-play/apps" ? search("2048 Blocks 3D", "com.loop.packedloop") : [reviewsSample]));
    const { out } = await signup(c, { game: "2048 blocks 3d", company: "Studio 9" });
    expect(out.email).toBe("sent");
    expect(sent[0]!.subject).toBe("What 2048 Blocks 3D's players are saying");
  });
});

describe("repeat signups", () => {
  it("emails someone who signs up again, each time with its own send key, up to 3 a day", async () => {
    const { c, sent } = ctx(async () => [reviewsSample]);
    for (let i = 0; i < 3; i++) expect((await signup(c, { game: "Parking Loop", storeUrl: link })).out.email).toBe("sent");
    expect(new Set(sent.map((s) => s.idempotencyKey)).size).toBe(3);
    const fourth = await signup(c, { game: "Parking Loop", storeUrl: link });
    expect(fourth.out.email).toBe("blocked");
    expect(fourth.progress.steps.map((s) => s.text)).toEqual(["Got it. Starting now", expect.stringMatching(/^Reading /), expect.stringMatching(/^Found it: /), "Writing your email", "We've already emailed you today. Check your inbox"]);
  });

  it("starts each run's progress fresh", async () => {
    const { c } = ctx(async () => [reviewsSample]);
    const first = await signup(c, { storeUrl: link });
    start(first.lead.id, "Got it. Starting now");
    expect(status(first.lead.id)).toMatchObject({ done: false, steps: [{ text: "Got it. Starting now" }] });
  });
});

describe("game lookup and links", () => {
  it("matches typed names to store titles strictly", () => {
    expect(titleMatches("candy crush", "Candy Crush Saga")).toBe(true);
    expect(titleMatches("candycrush", "Candy Crush Saga")).toBe(true);
    expect(titleMatches("Royal Match game", "Royal Match")).toBe(true);
    expect(titleMatches("royal match", "Royal Kingdom")).toBe(false);
    expect(titleMatches("block puzzle", "Block Blast!")).toBe(false);
    expect(titleMatches("", "Anything")).toBe(false);
  });

  it("prefers the store's highlighted app, then the first matching result", () => {
    expect(parseAppSearch(search("Royal Match", "com.dreamgames.royalmatch"), "royal match")?.appId).toBe("com.dreamgames.royalmatch");
    expect(parseAppSearch({ organic_results: [{ items: [{ title: "Royal Kingdom", product_id: "a.b" }, { title: "Royal Match", product_id: "c.d" }] }] }, "royal match")?.appId).toBe("c.d");
    expect(parseAppSearch({ organic_results: [] }, "royal match")).toBeNull();
  });

  it("keeps a signup with a messy link instead of failing it", async () => {
    const store = new MemoryStore();
    const bare = await intakeLead({ ...form, storeUrl: "play.google.com/store/apps/details?id=com.loop.packedloop" }, store);
    expect(bare.ok && bare.appId).toBe("com.loop.packedloop");
    const junk = await intakeLead({ ...form, storeUrl: "not a link at all" }, store);
    expect(junk.ok && junk.appId).toBeNull();
    const inName = await intakeLead({ ...form, game: link }, store);
    expect(inName.ok && [inName.appId, inName.game]).toEqual(["com.loop.packedloop", null]);
    expect(appIdFromStoreUrl("https://play.google.com/store/apps/details?id=")).toBeNull();
    expect(appIdFromStoreUrl("https://example.com/?id=com.loop.packedloop")).toBeNull();
  });
});

describe("team test addresses", () => {
  const team = ["noel_sason@berkeley.edu", "noeljsason@gmail.com"];
  it("tags +tag and Gmail-dot variants of team addresses, and only those", () => {
    expect(mailboxKey("Noel_Sason+judge1@Berkeley.edu")).toBe("noel_sason@berkeley.edu");
    expect(isTeamEmail("noel_sason+judge1@berkeley.edu", team)).toBe(true);
    expect(isTeamEmail("noel.j.sason+x@gmail.com", team)).toBe(true);
    expect(isTeamEmail("noel_sason@berkeley.edu", team)).toBe(true);
    expect(isTeamEmail("judge@ycombinator.com", team)).toBe(false);
    expect(isTeamEmail("noel_sason@berkeley.edu.evil.com", team)).toBe(false);
    expect(isTeamEmail("someone+noel_sason@berkeley.edu", team)).toBe(false);
    expect(isTeamEmail(null, team)).toBe(false);
  });
});

describe("AgentMail sender", () => {
  const limitBody = JSON.stringify({ name: "RateLimitError", code: "rate_limit_exceeded", message: "New account recipient limit exceeded: this organization may email at most 10 distinct recipients in its first 24 hours." });

  it("fails at once on the new-recipient limit instead of waiting out Retry-After", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(limitBody, { status: 429, headers: { "content-type": "application/json", "retry-after": "68470" } });
    }) as typeof fetch;
    const sender = new AgentMailSender("am_test", "levelai@agentmail.to", 5, fetchImpl);
    const t0 = Date.now();
    await expect(sender.send({ to: "a@b.co", subject: "s", text: "t", idempotencyKey: "k" })).rejects.toThrow(/recipient limit/);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(calls).toBe(1);
  });

  it("retries a server error once with the same key", async () => {
    const keys: Array<string | null> = [];
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get("idempotency-key"));
      return keys.length === 1
        ? new Response("{}", { status: 502, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({ message_id: "<m1>", thread_id: "t1" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const sender = new AgentMailSender("am_test", "levelai@agentmail.to", 5, fetchImpl);
    expect(await sender.send({ to: "a@b.co", subject: "s", text: "t", idempotencyKey: "k1" })).toEqual({ messageId: "<m1>" });
    expect(keys).toEqual(["k1", "k1"]);
  });
});

describe("the fast store-page lookup", () => {
  it("parses result ids and titles from the store's search page", async () => {
    const { parsePlaySearchPage } = await import("../src/research/play-search.js");
    const html = '<a href="/store/apps/details?id=com.dreamgames.royalmatch" aria-label="Royal Match" class="Qfxief"></a>'
      + '<a href="/store/apps/details?id=com.dreamgames.royalmatch" aria-label="Royal Match"></a>'
      + '<a href="/store/apps/details?id=com.b.c" aria-label="Tom &amp; Jerry&#39;s Puzzle"></a>';
    expect(parsePlaySearchPage(html)).toEqual([
      { appId: "com.dreamgames.royalmatch", title: "Royal Match" },
      { appId: "com.b.c", title: "Tom & Jerry's Puzzle" },
    ]);
  });

  it("wins the race when the other lookup is slow", async () => {
    setPlaySearch(async () => ({ appId: "com.loop.packedloop", title: "Parking Loop", developer: "x", rating: null, downloads: null }));
    const { c, sent, calls } = ctx(async (a) => (a.endpoint === "/google-play/apps" ? never() : [reviewsSample]));
    const t0 = Date.now();
    const { out } = await signup(c, { game: "Parking Loop" });
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(out).toMatchObject({ audited: true, email: "sent" });
    expect(calls.some((x) => x.endpoint === "/google-play/app-reviews")).toBe(true);
    expect(sent[0]!.subject).toBe("What Parking Loop's players are saying");
  });
});
