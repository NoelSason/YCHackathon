import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../mcp/tools.js";
import { naiveClient } from "../naive.js";
import { composePost, gatherStats, publish, type Angle } from "./posts.js";
import { postOnXFromPhone } from "./phone-post.js";
import { stopLoopTask } from "../mobile/loop.js";

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

export interface CycleOptions {
  /** Post this angle if it has something to say (post-now: research when there are new numbers). */
  preferAngle?: Angle;
  /** Posts per network allowed on top of SOCIAL_DAILY_CAP (post-now uses the demo reserve). */
  extraCap?: number;
}

export async function runSocialCycle(ctx: ToolContext, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)), opts: CycleOptions = {}) {
  const key = ctx.config.NAIVE_API_KEY_SOCIAL;
  const identityId = ctx.config.NAIVE_SOCIAL_IDENTITY_ID;
  if (!key || !identityId) return { posted: [] as string[], reason: "social not set up" };
  const naive = naiveClient(key, ctx.config.NAIVE_BASE_URL);
  const stats = await gatherStats(ctx.store);
  const state = load();
  const playtest = ctx.config.PUBLIC_BASE_URL.startsWith("https://") ? `${ctx.config.PUBLIC_BASE_URL}/playtest` : null;
  const angle = opts.preferAngle === "research" && stats.reviewsRead > state.lastResearchReviews ? "research" : pickAngle(state, stats.reviewsRead, Boolean(playtest));
  const post = composePost(angle, stats, { site: ctx.config.SITE_URL, playtest });
  const dailyCap = ctx.config.SOCIAL_DAILY_CAP + (opts.extraCap ?? 0);
  let phoneTried = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await publish({ naive, identityId, store: ctx.store, post, dailyCap });
    // X refuses (or never confirms) our API posts; post the same text from the cloud iPhone in Safari
    // instead. At most once per cycle, so a retry for another network never starts a second phone task.
    const xRejected = r.skipped.find((x) => x.platform === "x" && /rejected|failed|not confirmed|capacity/i.test(x.reason));
    if (xRejected && ctx.mobilerun && !phoneTried) {
      phoneTried = true;
      const phone = await postOnXFromPhone(ctx, post.content).catch(() => ({ posted: false }));
      if (phone.posted) r.posted.push("x");
    }
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

/** True when `date` falls in a quiet range like "3-14" or "23-6,13-14" (Pacific hours, end exclusive). */
export function inQuietHours(spec: string, date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(date));
  return spec
    .split(",")
    .map((p) => p.trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/))
    .some((m) => {
      if (!m) return false;
      const a = Number(m[1]), b = Number(m[2]);
      return a <= b ? hour >= a && hour < b : hour >= a || hour < b;
    });
}

// One social cycle at a time, whether the schedule or a person started it.
let cycleRunning = false;

export interface PostJob {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "done" | "failed";
  posted: string[];
  reason: string | null;
}
const jobs = new Map<string, PostJob>();

/**
 * POST /social/post-now: compose the next honest post and publish it through the normal path
 * (Naïve's Social API, then the iPhone in Safari for X). Returns at once; the job runs in the
 * background and its rows land in the activity log. Uses the demo reserve on top of the daily cap.
 */
export function postNow(ctx: ToolContext, opts: { preempt?: boolean } = {}): { ok: true; job: PostJob } | { ok: false; error: string; job?: PostJob } {
  if (cycleRunning) {
    const current = [...jobs.values()].find((j) => j.status === "running");
    return { ok: false, error: "a social post is already in progress", job: current };
  }
  if (!ctx.config.NAIVE_API_KEY_SOCIAL || !ctx.config.NAIVE_SOCIAL_IDENTITY_ID) return { ok: false, error: "social not set up" };
  const job: PostJob = { id: randomUUID(), startedAt: new Date().toISOString(), finishedAt: null, status: "running", posted: [], reason: null };
  jobs.set(job.id, job);
  if (jobs.size > 50) jobs.delete(jobs.keys().next().value!);
  cycleRunning = true;
  // Said plainly in the feed: a person asked for this post; the agent wrote and posted it.
  void ctx.store.logActivity({
    at: job.startedAt, agent: "marketing", action: "asked to post now",
    why: "a person pressed post-now (demo trigger); the agent writes the post from live numbers", result: null, costUsd: null, human: false,
  }).catch(() => undefined);
  // A person is waiting: cut the loop's market study short (never a paid order) so the phone is free.
  const preempt = opts.preempt !== false && ctx.mobilerun
    ? stopLoopTask(ctx.mobilerun, "the phone was needed to post on X").then(async (name) => {
        if (name) await ctx.store.logActivity({
          at: new Date().toISOString(), agent: "marketing", action: `asked the phone to stop studying ${name} early`,
          why: "a post on X was requested; paid orders are never interrupted", result: null, costUsd: null, human: false,
        });
      }).catch(() => undefined)
    : Promise.resolve();
  void preempt.then(() => runSocialCycle(ctx, undefined, { preferAngle: "research", extraCap: ctx.config.SOCIAL_DEMO_RESERVE }))
    .then((r) => Object.assign(job, { status: r.posted.length ? "done" : "failed", posted: r.posted, reason: r.reason }))
    .catch((err) => Object.assign(job, { status: "failed", reason: err instanceof Error ? err.message.slice(0, 200) : "unknown" }))
    .finally(() => {
      job.finishedAt = new Date().toISOString();
      cycleRunning = false;
    });
  return { ok: true, job };
}

export const postJob = (id: string): PostJob | null => jobs.get(id) ?? null;

export function startSocialLoop(ctx: ToolContext, minutes: number, firstDelayMs = 5 * 60_000): () => void {
  const cycle = async () => {
    if (cycleRunning) return;
    if (inQuietHours(ctx.config.SOCIAL_QUIET_HOURS)) {
      console.log(`social loop: quiet hours (${ctx.config.SOCIAL_QUIET_HOURS} PT), not posting`);
      return;
    }
    cycleRunning = true;
    try {
      const r = await runSocialCycle(ctx);
      console.log(r.posted.length ? `social loop: posted on ${r.posted.join(", ")}` : `social loop: nothing posted (${r.reason})`);
    } catch (err) {
      console.error("social loop failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
    } finally {
      cycleRunning = false;
    }
  };
  const first = setTimeout(cycle, firstDelayMs);
  const every = setInterval(cycle, minutes * 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
