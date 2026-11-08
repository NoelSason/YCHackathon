import { describe, expect, it } from "vitest";
import { composeReport } from "../src/leads/playtest-offer.js";
import { composeWelcome } from "../src/leads/live.js";
import { esc } from "../src/email/html.js";

const base = { companyName: "Level AI", postalAddress: "1752 Shattuck Avenue, Berkeley, CA 94704" };

describe("HTML emails", () => {
  it("renders a playtest report with pass/fail badges, the notes, and the legal footer", () => {
    const { html, body } = composeReport({
      ...base, name: "Noel Sason", team: "Level AI", appUrl: "https://levelai.vercel.app", error: null,
      outcome: { taskId: "t", status: "completed", succeeded: true, message: null, steps: 9, missingLevels: [],
        results: { results: [{ level: "app", loaded: true, touchOk: true, won: null, movesUsed: null, visualIssues: ["Button <cut> off"], stuckReason: null, notes: "Home page loads fast." }] } },
    });
    expect(html).toContain("Here's how your app did, Noel");
    expect(html).toContain("✓ Yes");
    expect(html).toContain("1 found");
    expect(html).toContain("Button &lt;cut&gt; off"); // escaped
    expect(html).not.toContain("<cut>");
    expect(html).toContain("Home page loads fast.");
    expect(html).toContain("1752 Shattuck Avenue");
    expect(html).toContain("Reply “stop”");
    expect(body).toContain("Loaded on iPhone: yes"); // plain-text version still sent
  });

  it("renders the welcome with the big evidence number and the real quote", () => {
    const d = composeWelcome({
      ...base, lead: { contactName: "Ada Lovelace", company: "Loop Games" }, gameTitle: "Parking Loop", sampleUrl: null,
      target: { appId: "com.loop.packedloop", appTitle: "Parking Loop", developer: "Loop Games", storeUrl: "", downloads: null, reviewsAnalyzed: 86,
        signalCounts: { too_easy: 7, too_hard: 0, wants_more_levels: 0, repetitive: 0 }, primarySignal: "too_easy",
        examples: [{ kind: "too_easy", quote: "it's way too easy.", rating: 3, timestamp: null }], reason: "", score: 8 },
    });
    expect(d.html).toContain("7 of 86");
    expect(d.html).toContain("it&#39;s way too easy.".replace("&#39;", "'"));
    expect(d.html).toContain("Reply for your free levels");
    expect(d.subject).toBe("What Parking Loop's players are saying");
  });

  it("escapes HTML", () => {
    expect(esc(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});
