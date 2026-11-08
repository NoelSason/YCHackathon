import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../mcp/tools.js";
import { naiveClient } from "../naive.js";
import { composePost, gatherStats, publish, type Angle } from "./posts.js";

/**
 * Posts on Level AI's connected social accounts on a schedule, rotating angles: live market
 * research, then levels, then the iPhone playtest. A research post goes out only when there are new
 * numbers since the last one (networks reject duplicate posts). Same guards as the Marketing agent's
 * tool: AI-generated label, only our own numbers, a per-network daily cap. If the social service is
 * busy, it retries a few times with a pause.
 */
const STATE_FILE = join(tmpdir(), "levelai-social-state.json");
type State = { turn: number; lastResearchReviews: number };

function load(): State {
  try {
    return { turn: 0, lastResearchReviews: 0, ...(JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<State>) };
  } catch {
    return { turn: 0, lastResearchReviews: 0 };
  }
}
function save(s: State) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(s));
  } catch {
    // Best effort.
  }
}

export function pickAngle(state: State, reviewsRead: number, hasPlaytestPage: boolean): Angle {
  const order: Angle[] = ["research", "levels", "research", hasPlaytestPage ? "playtest" : "levels"];
  for (let i = 0; i < order.length; i++) {
    const a = order[(state.turn + i) % order.length]!;
    if (a === "research" && reviewsRead <= state.lastResearchReviews) continue;
    return a;
  }
  return "levels";
}

export async function runSocialCycle(ctx: ToolContext, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  const key = ctx.config.NAIVE_API_KEY_SOCIAL;
  const identityId = ctx.config.NAIVE_SOCIAL_IDENTITY_ID;
  if (!key || !identityId) return { posted: [] as string[], reason: "social not set up" };
  const naive = naiveClient(key, ctx.config.NAIVE_BASE_URL);
  const stats = await gatherStats(ctx.store);
  const state = load();
  const playtest = ctx.config.PUBLIC_BASE_URL.startsWith("https://") ? `${ctx.config.PUBLIC_BASE_URL}/playtest` : null;
  const angle = pickAngle(state, stats.reviewsRead, Boolean(playtest));
  const post = composePost(angle, stats, { site: ctx.config.SITE_URL, playtest });
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await publish({ naive, identityId, store: ctx.store, post, dailyCap: ctx.config.SOCIAL_DAILY_CAP });
    const busy = r.skipped.some((s) => /capacity|rate/i.test(s.reason));
    if (r.posted.length || !busy) {
      if (r.posted.length) {
        save({ turn: state.turn + 1, lastResearchReviews: angle === "research" ? stats.reviewsRead : state.lastResearchReviews });
      }
      return { posted: r.posted, reason: r.posted.length ? null : r.skipped.map((s) => `${s.platform}: ${s.reason}`).join("; ") };
    }
    await sleep(30_000);
  }
  return { posted: [], reason: "social service busy" };
}

export function startSocialLoop(ctx: ToolContext, minutes: number, firstDelayMs = 5 * 60_000): () => void {
  let running = false;
  const cycle = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runSocialCycle(ctx);
      console.log(r.posted.length ? `social loop: posted on ${r.posted.join(", ")}` : `social loop: nothing posted (${r.reason})`);
    } catch (err) {
      console.error("social loop failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
    } finally {
      running = false;
    }
  };
  const first = setTimeout(cycle, firstDelayMs);
  const every = setInterval(cycle, minutes * 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
