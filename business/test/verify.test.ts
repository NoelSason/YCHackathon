import { beforeEach, describe, expect, it } from "vitest";
import type { MonidRunner, StoreGame } from "../src/research/monid.js";
import type { RawReview } from "../src/research/signals.js";
import { buildTarget, findTargets } from "../src/research/targets.js";
import { describeVerification, findVerbatim, resetVerifyBudget, verifyCallsToday, verifyTarget } from "../src/research/verify.js";

const game: StoreGame = { appId: "com.example.blocks", title: "Block Puzzle", developer: "Small Studio", rating: 4.2, downloads: "1,000,000+" };

const reviews: RawReview[] = [
  { review_text: "Fun at first. But the levels are way too easy.", rating: 3 },
  { review_text: "I liked it, way too easy though, finished in a day.", rating: 3 },
  { review_text: "Honestly too easy. No real challenge at all.", rating: 2 },
  { review_text: "Some levels feel too easy to me lol jk this is the best game ever, 5 stars.", rating: 5 },
  { review_text: "Great game, relaxing.", rating: 5 },
  { review_text: "The puzzles are a breeze. I beat 300 levels without thinking once.", rating: 2 },
];

type Body = { candidates: Array<{ id: string; sentence: string }>; other_reviews: Array<{ id: string; text: string }> };
type Answer = { verdicts: Array<{ id: string; keep: boolean; why: string }>; missed: Array<{ review_id: string; sentence: string; kind: string }> };

/** A fake OpenAI endpoint. `decide` sees what we sent and writes the model's answer. */
function fakeOpenAI(decide: (b: Body) => Answer) {
  const calls: Array<{ url: string; model: string; auth: string | null }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }> };
    calls.push({ url: String(url), model: req.model, auth: new Headers(init?.headers).get("authorization") });
    const body = JSON.parse(req.messages[1]!.content) as Body;
    const content = JSON.stringify(decide(body));
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const opts = (fetchImpl: typeof fetch, extra: Partial<{ dailyCalls: number; apiKey: string | undefined }> = {}) => ({
  apiKey: "apiKey" in extra ? extra.apiKey : "sk-test",
  model: "gpt-5.4-mini",
  dailyCalls: extra.dailyCalls ?? 300,
  fetchImpl,
  timeoutMs: 1000,
});

beforeEach(() => resetVerifyBudget());

describe("verifyTarget", () => {
  it("keeps confirmed quotes, drops rejected ones, and rebuilds the counts and reason", async () => {
    const regex = buildTarget(game, reviews);
    expect(regex.signalCounts.too_easy).toBe(4);

    const { impl, calls } = fakeOpenAI((b) => ({
      verdicts: b.candidates.map((c) => ({ id: c.id, keep: !c.sentence.includes("jk"), why: c.sentence.includes("jk") ? "joke, it's praise" : "complains levels are too easy" })),
      missed: [],
    }));
    const { target, report } = await verifyTarget(game, reviews, regex, { ...opts(impl), recall: false });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]!.model).toBe("gpt-5.4-mini");
    expect(report.status).toBe("verified");
    expect(report.rejected).toHaveLength(1);
    expect(target.signalCounts.too_easy).toBe(3);
    expect(target.primarySignal).toBe("too_easy");
    expect(target.reason).toMatch(/^3 of the 6 newest Google Play reviews of Block Puzzle/);
    expect(target.examples.map((e) => e.quote).join(" ")).not.toContain("jk");
    expect(target.score).toBeLessThan(regex.score);
  });

  it("drops a game below the threshold when most quotes don't hold up", async () => {
    const regex = buildTarget(game, reviews);
    const { impl } = fakeOpenAI((b) => ({ verdicts: b.candidates.map((c, i) => ({ id: c.id, keep: i === 0, why: "x" })), missed: [] }));
    const { target, report } = await verifyTarget(game, reviews, regex, { ...opts(impl), recall: false });
    expect(target.signalCounts.too_easy).toBe(1);
    const line = describeVerification(report, game.title, 3);
    expect(line?.action).toBe("checked 4 quotes for Block Puzzle; 3 weren't about the levels");
    expect(line?.result).toBe("too easy: 4 → 1 reviews; not enough evidence to pitch");
  });

  it("treats a candidate the model skipped as unconfirmed", async () => {
    const regex = buildTarget(game, reviews);
    const { impl } = fakeOpenAI((b) => ({ verdicts: b.candidates.slice(1).map((c) => ({ id: c.id, keep: true, why: "ok" })), missed: [] }));
    const { target } = await verifyTarget(game, reviews, regex, { ...opts(impl), recall: false });
    expect(target.signalCounts.too_easy).toBe(3);
  });

  it("adds a missed complaint only when the sentence is in the review word for word", async () => {
    const regex = buildTarget(game, reviews);
    const { impl } = fakeOpenAI((b) => {
      const breeze = b.other_reviews.find((o) => o.text.includes("breeze"))!;
      const relaxing = b.other_reviews.find((o) => o.text.includes("relaxing"));
      return {
        verdicts: b.candidates.map((c) => ({ id: c.id, keep: true, why: "ok" })),
        missed: [
          // Exact (minus the period): counts, and the review's own full sentence is quoted.
          { review_id: breeze.id, sentence: "I beat 300 levels without thinking once", kind: "too_easy" },
          // Paraphrase: not in the review, so it's ignored.
          { review_id: breeze.id, sentence: "The levels are far too easy and boring", kind: "repetitive" },
          // A review we never sent: ignored.
          { review_id: "r99", sentence: "Fun at first.", kind: "too_easy" },
          ...(relaxing ? [{ review_id: relaxing.id, sentence: "Great game", kind: "too_hard" }] : []),
        ],
      };
    });
    const { target, report } = await verifyTarget(game, reviews, regex, opts(impl));
    expect(report.added).toEqual([{ kind: "too_easy", sentence: "I beat 300 levels without thinking once." }]);
    expect(target.signalCounts.too_easy).toBe(5);
    expect(target.signalCounts.repetitive).toBe(0);
    expect(target.signalCounts.too_hard).toBe(0);
    const texts = reviews.map((r) => r.review_text ?? "");
    for (const ex of target.examples) expect(texts.some((t) => t.includes(ex.quote.replace(/…$/, ""))), ex.quote).toBe(true);
  });

  it("falls back to the regex result unchanged when the call fails, after one retry", async () => {
    const regex = buildTarget(game, reviews);
    let n = 0;
    const impl = (async () => {
      n++;
      return new Response(JSON.stringify({ error: { code: "server_error", message: "boom sk-test" } }), { status: 500 });
    }) as typeof fetch;
    const { target, report } = await verifyTarget(game, reviews, regex, opts(impl));
    expect(n).toBe(2);
    expect(report.status).toBe("failed");
    expect(report.error).toBe("HTTP 500 server_error");
    expect(report.error).not.toContain("sk-");
    expect(target).toBe(regex);
    expect(describeVerification(report, game.title, 3)?.result).toBe("used the keyword match as is");
  });

  it("falls back on a network error, a timeout, or malformed output", async () => {
    const regex = buildTarget(game, reviews);
    const throwing = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    expect((await verifyTarget(game, reviews, regex, opts(throwing))).target).toBe(regex);

    const slow = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as typeof fetch;
    const timedOut = await verifyTarget(game, reviews, regex, { ...opts(slow), timeoutMs: 20 });
    expect(timedOut.report.error).toBe("timed out");
    expect(timedOut.target).toBe(regex);

    const junk = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"verdicts\": 3}" } }] }))) as typeof fetch;
    expect((await verifyTarget(game, reviews, regex, opts(junk))).target).toBe(regex);
  });

  it("doesn't call out without a key", async () => {
    const regex = buildTarget(game, reviews);
    const { impl, calls } = fakeOpenAI(() => ({ verdicts: [], missed: [] }));
    const { target, report } = await verifyTarget(game, reviews, regex, opts(impl, { apiKey: undefined }));
    expect(calls).toHaveLength(0);
    expect(report.status).toBe("no_key");
    expect(target).toBe(regex);
    expect(describeVerification(report, game.title, 3)).toBeNull();
  });

  it("respects the daily call cap", async () => {
    const regex = buildTarget(game, reviews);
    const { impl, calls } = fakeOpenAI((b) => ({ verdicts: b.candidates.map((c) => ({ id: c.id, keep: true, why: "ok" })), missed: [] }));
    expect((await verifyTarget(game, reviews, regex, opts(impl, { dailyCalls: 2 }))).report.status).toBe("verified");
    expect((await verifyTarget(game, reviews, regex, opts(impl, { dailyCalls: 2 }))).report.status).toBe("verified");
    const third = await verifyTarget(game, reviews, regex, opts(impl, { dailyCalls: 2 }));
    expect(third.report.status).toBe("capped");
    expect(third.target).toBe(regex);
    expect(calls).toHaveLength(2);
    expect(verifyCallsToday()).toBe(2);
  });

  it("counts a retry against the cap", async () => {
    const regex = buildTarget(game, reviews);
    let n = 0;
    const impl = (async () => { n++; return new Response("{}", { status: 503 }); }) as typeof fetch;
    const r = await verifyTarget(game, reviews, regex, opts(impl, { dailyCalls: 1 }));
    expect(n).toBe(1);
    expect(r.report.status).toBe("capped");
  });
});

describe("findVerbatim", () => {
  it("returns the review's own sentence, or null for anything not in it", () => {
    const text = "Love the art.  The levels   are too easy after level 50! Still fun.";
    expect(findVerbatim(text, "The levels are too easy after level 50")).toBe("The levels   are too easy after level 50!");
    expect(findVerbatim(text, "levels are much too easy")).toBeNull();
    expect(findVerbatim(text, "too easy")).toBeNull(); // too short to be evidence
  });
});

describe("findTargets with a verify step", () => {
  it("passes the verified target to onRead and the results", async () => {
    const monid: MonidRunner = {
      async run(args) {
        if (args.endpoint === "/google-play/games") {
          return { organic_results: [{ items: [{ product_id: game.appId, title: game.title, author: game.developer, downloads: game.downloads }] }] };
        }
        return [{ items: reviews }];
      },
    };
    const { impl } = fakeOpenAI((b) => ({ verdicts: b.candidates.map((c) => ({ id: c.id, keep: !c.sentence.includes("jk"), why: "x" })), missed: [] }));
    const read: number[] = [];
    const targets = await findTargets(monid, {
      onRead: (t) => read.push(t.signalCounts.too_easy),
      verify: async (g, r, t) => (await verifyTarget(g, r, t, { ...opts(impl), recall: false })).target,
    });
    expect(read).toEqual([3]);
    expect(targets[0]!.signalCounts.too_easy).toBe(3);
  });
});
