import { describe, expect, it } from "vitest";
import { catalogPost, customerPackPost, nextVerifiedPost } from "../src/marketing/verified.js";
import type { Query } from "../src/store.js";

const game = { game_id: "match3", name: "Gem Garden", levels: 220, games: 32000, gap: 3.44 };
const fake = (packs: unknown[], games: unknown[] = [game]): Query =>
  (async (text: string) => (/biz_pack_deliveries/.test(text) ? packs : games)) as unknown as Query;

describe("verified posts", () => {
  it("states only measured numbers and fits on X", () => {
    const p = catalogPost({ gameId: "match3", name: "Gem Garden", levels: 220, botGames: 32000, gapPoints: 3.44 }, "https://levelai.vercel.app/");
    expect(p.content).toContain("Verified by Level AI: Gem Garden. 220 levels, 32,000 simulated bot games");
    expect(p.content).toContain("within 3.4 points");
    expect(p.content.length).toBeLessThanOrEqual(280);
    expect(p.platforms).toEqual(["x"]);
  });

  it("never names the studio on a customer pack", () => {
    const p = customerPackPost({ packId: "p1", levels: 20, botGames: 4000, gapPoints: 2 }, "https://s");
    expect(p.content).toContain("a studio's new 20-level pack");
    expect(p.content).toContain("https://s/pricing");
  });

  it("posts a delivered customer pack once, ahead of the rotation", async () => {
    const q = fake([{ pack_id: "p1", levels: 20, games: 4000, gap: 2 }]);
    const r = await nextVerifiedPost(q, { lastVerified: true }, "https://s");
    expect(r?.post.content).toContain("a studio's new");
    expect(r?.state.announcedPacks).toEqual(["p1"]);
  });

  it("alternates catalog posts and rotates games", async () => {
    const q = fake([], [game, { ...game, game_id: "watersort", name: "Splash Sort" }]);
    expect(await nextVerifiedPost(q, { lastVerified: true }, "https://s")).toBeNull();
    const first = await nextVerifiedPost(q, {}, "https://s");
    expect(first?.post.content).toContain("Gem Garden");
    const second = await nextVerifiedPost(q, { verifiedTurn: first!.state.verifiedTurn! }, "https://s");
    expect(second?.post.content).toContain("Splash Sort");
  });

  it("stays quiet when nothing is measured", async () => {
    expect(await nextVerifiedPost(fake([], []), {}, "https://s")).toBeNull();
  });
});
