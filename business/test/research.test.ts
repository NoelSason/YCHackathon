import { describe, expect, it } from "vitest";
import reviewsSample from "./fixtures/reviews-sample.json" with { type: "json" };
import gamesSample from "./fixtures/games-sample.json" with { type: "json" };
import { classifyReview, countSignals, excerpt, extractSignals } from "../src/research/signals.js";
import { parseGames, parseReviews, type MonidRunner } from "../src/research/monid.js";
import { buildTarget, findTargets, parseDownloads } from "../src/research/targets.js";

describe("classifyReview", () => {
  it("finds too-easy complaints in real review wording", () => {
    expect(classifyReview("meh. it's a nice little game... but it's way too easy.")).toContain("too_easy");
    expect(classifyReview("this game is boring tbh, i don't think it's possible to fail a level")).toContain("too_easy");
    expect(classifyReview("great game but it takes too long for the levels to actually prove a challenge")).toContain("too_easy");
    expect(classifyReview("the first 20 levels are impossible to fail but after that you have to think")).toContain("too_easy");
  });

  it("finds too-hard and more-levels complaints", () => {
    expect(classifyReview("I've been stuck on level 245 for a week")).toContain("too_hard");
    expect(classifyReview("Please add more levels, I finished all levels already")).toContain("wants_more_levels");
    expect(classifyReview("the levels are repetitive")).toContain("repetitive");
  });

  it("doesn't count praise like 'not too hard' as a complaint (false positives from the Nov 7 run)", () => {
    expect(classifyReview("This game is challenging but not too hard to figure out")).toEqual([]);
    expect(classifyReview("it's challenging but not too hard.")).toEqual([]);
    expect(classifyReview("Really enjoy the game. Not too difficult but not too easy, either.")).toEqual([]);
    expect(classifyReview("not too easy, but way too hard after level 40")).toContain("too_hard");
  });

  it("ignores the 11 false-positive patterns found by hand on Nov 7", () => {
    const none = [
      "the puzzles aren't too hard",
      "Really fun game that isn't too easy or too hard.",
      "not too easy, nor too hard",
      "balanced with not being too easy or hard",
      "Some games are way too easy.",
      "it's not impossible to win now",
      "not like other games where you have to buy coins to beat levels",
      "takes too long to get through the 20 ads/events",
      "the same repetitive adds over and over again",
      "glitches and repetitive crashes",
      "the repetitive, interupting ads",
      "it won't let me play any more levels",
      "you need internet to access more levels",
      "can play again for a few more levels",
      "Pay to win game",
      "'ad not ready' for days. Stuck on level 294",
      "resolution on phone is bad..lvl 29 I cant pass",
    ];
    for (const q of none) expect(classifyReview(q), q).toEqual([]);
    expect(classifyReview("levels are too easy to lose")).toEqual(["too_hard"]);
  });

  it("still catches the real complaints from the same run", () => {
    expect(classifyReview("Lvl 136 is impossible. I've tried it every way")).toContain("too_hard");
    expect(classifyReview("Spent about 2 hours trying to clear level 4. it is physically impossible to beat.")).toContain("too_hard");
    expect(classifyReview("super fun until you get to the level where it's impossible to beat without paying for power ups")).toContain("too_hard");
    expect(classifyReview("level 376 is actually quite literally impossible without using a single power-up")).toContain("too_hard");
    expect(classifyReview("the levels get repetitive after a while")).toContain("repetitive");
    expect(classifyReview("please add more levels")).toContain("wants_more_levels");
  });

  it("quotes the sentence that shows the problem, not the start of the review", () => {
    const review = "2nd update - I emailed the developers, and they listened. Level 12 is impossible though. Love the art.";
    const [sig] = extractSignals([{ review_text: review, rating: 3 }]);
    expect(sig).toMatchObject({ kind: "too_hard", quote: "Level 12 is impossible though." });
  });

  it("ignores ad and price complaints, which we can't fix", () => {
    expect(classifyReview("ads after literally every level")).toEqual([]);
    expect(classifyReview("$40 to remove ads is crazy")).toEqual([]);
  });
});

describe("excerpt", () => {
  it("keeps short text and trims long text at a word boundary", () => {
    expect(excerpt("short review")).toBe("short review");
    const long = "word ".repeat(60);
    const out = excerpt(long, 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("real sample (Parking Loop, 86 newest reviews, Nov 7 2026)", () => {
  const reviews = parseReviews([reviewsSample]);

  it("parses the Monid review shape", () => {
    expect(reviews.length).toBe(86);
  });

  it("finds the too-easy pattern a person can see in the reviews", () => {
    const counts = countSignals(extractSignals(reviews));
    expect(counts.too_easy).toBeGreaterThanOrEqual(5);
    expect(counts.too_hard).toBeLessThan(counts.too_easy);
  });

  it("builds a target with a checkable reason and no reviewer names", () => {
    const target = buildTarget(
      { appId: "com.loop.packedloop", title: "Parking Loop", developer: "Loop Games A.S.", rating: 4.27, downloads: "100,000+" },
      reviews,
    );
    expect(target.primarySignal).toBe("too_easy");
    expect(target.reason).toMatch(/^\d+ of the 86 newest Google Play reviews of Parking Loop say the levels are too easy/);
    expect(target.examples.length).toBeGreaterThan(0);
    expect(JSON.stringify(target)).not.toMatch(/profile_name|Zeno/);
  });
});

describe("findTargets", () => {
  it("skips big studios and ranks by complaint density", async () => {
    const monid: MonidRunner = {
      async run({ endpoint, body }) {
        if (endpoint === "/google-play/games") return gamesSample;
        const appId = (body as { app_id: string }).app_id;
        // Every app gets the real Parking Loop reviews except one with none.
        return appId === "com.block.juggle" ? [{ items: [] }] : [reviewsSample];
      },
    };
    const targets = await findTargets(monid, { maxGames: 5 });
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => !/dream games/i.test(t.developer))).toBe(true);
    expect(targets.find((t) => t.appId === "com.block.juggle")).toBeUndefined();
    for (let i = 1; i < targets.length; i++) expect(targets[i - 1]!.score).toBeGreaterThanOrEqual(targets[i]!.score);
  });

  it("parses the litescrape chart shape", () => {
    const games = parseGames(gamesSample);
    expect(games[0]).toMatchObject({ appId: "com.oakever.meowdoku", developer: "Oakever Games" });
  });

  it("parses download counts", () => {
    expect(parseDownloads("100,000,000+")).toBe(100_000_000);
    expect(parseDownloads(null)).toBeNull();
  });
});

describe("large results", () => {
  it("follows a download link to the real data", async () => {
    const { resolveDownload } = await import("../src/research/monid.js");
    const fake = (async () => new Response(JSON.stringify({ organic_results: [] }))) as unknown as typeof fetch;
    expect(await resolveDownload({ data: { download_link: "https://example.com/x", content_type: "application/json" } }, fake)).toEqual({ organic_results: [] });
    expect(await resolveDownload({ organic_results: [1] }, fake)).toEqual({ organic_results: [1] });
  });
});
