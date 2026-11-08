import type { SocialPlatform } from "@usenaive-sdk/managed-agents";
import type { NaiveClient } from "../naive.js";
import type { Store } from "../store.js";
import type { ActivityEntry } from "../types.js";

/**
 * The Marketing agent's posts: short "for hire" posts on the networks where studios and indie
 * developers look for help (LinkedIn, X, Reddit, Threads, Bluesky), published through Naïve's
 * Social API on Level AI's own connected accounts. Posts are labeled as AI-generated, state only
 * numbers from our own records, and are capped per network per day.
 */
export interface Stats {
  studiosResearched: number;
  studiosEmailed: number;
  playtestsDelivered: number;
  /** Market research totals from the outreach loop's chart passes. */
  reviewsRead: number;
  gamesRead: number;
  tooHard: number;
  tooEasy: number;
  wantsMoreLevels: number;
  repetitive: number;
}

export async function gatherStats(store: Store): Promise<Stats> {
  const leads = await store.listLeads();
  const runs = await store.listResearchRuns(500).catch(() => []);
  const sum = (k: "reviewsRead" | "gamesRead" | "tooHard" | "tooEasy" | "wantsMoreLevels" | "repetitive") => runs.reduce((n, r) => n + r[k], 0);
  return {
    reviewsRead: sum("reviewsRead"),
    gamesRead: sum("gamesRead"),
    tooHard: sum("tooHard"),
    tooEasy: sum("tooEasy"),
    wantsMoreLevels: sum("wantsMoreLevels"),
    repetitive: sum("repetitive"),
    studiosResearched: leads.filter((l) => l.source === "research").length,
    studiosEmailed: leads.filter((l) => ["emailed", "replied", "pilot_offered", "pilot_paid", "delivered"].includes(l.stage)).length,
    playtestsDelivered: leads.filter((l) => l.source === "inbound_form" && l.stage === "delivered" && (l.reason ?? "").startsWith("Ordered a phone playtest")).length,
  };
}

export type Angle = "levels" | "playtest" | "research";

export interface Post {
  title: string;
  content: string;
  platforms: SocialPlatform[];
}

/** One post per angle, written for people who hire help for their games. */
const pct = (n: number, total: number): number => Math.round((n / total) * 100);

export function composePost(angle: Angle, stats: Stats, links: { site: string; playtest: string | null }): Post {
  const complaints = stats.tooHard + stats.tooEasy + stats.wantsMoreLevels + stats.repetitive;
  if (angle === "research" && stats.reviewsRead > 0 && complaints >= 10) {
    const parts = [
      [stats.tooHard, "say a level is too hard"],
      [stats.tooEasy, "say it's too easy"],
      [stats.wantsMoreLevels, "want more levels"],
      [stats.repetitive, "say it gets repetitive"],
    ] as Array<[number, string]>;
    // Percentages only once the sample is big enough to mean something; counts before that.
    const big = complaints >= 50;
    const breakdown = parts.filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).map(([n, t]) => `${big ? `${pct(n, complaints)}%` : n} ${t}`).join(", ");
    const lead = big ? "When players complain about the levels," : `${complaints} reviews complain about the levels:`;
    return {
      title: "What puzzle-game players say about levels",
      content: `Our agents have read ${stats.reviewsRead.toLocaleString("en-US")} player reviews of ${stats.gamesRead} top mobile puzzle and casual games. ${lead} ${breakdown}. Want this for your game? Free difficulty audit: ${links.site.replace(/\/$/, "")}/join`,
      platforms: ["linkedin", "x", "threads", "bluesky", "reddit"],
    };
  }
  if (angle === "playtest" && links.playtest) {
    const proof = stats.playtestsDelivered > 0 ? ` We've delivered ${stats.playtestsDelivered} so far.` : "";
    return {
      title: "[For Hire] Your app played on a real iPhone, with a report in about 10 minutes",
      content: `Building an app or game? We'll play it on a real iPhone like a first-time user and email you what works, what breaks, and where people get stuck, in about 10 minutes.${proof}\n\nOrder one: ${links.playtest}`,
      platforms: ["linkedin", "x", "threads", "bluesky", "reddit"],
    };
  }
  const proof =
    stats.studiosResearched > 0
      ? ` This week we read the newest reviews of ${stats.studiosResearched} puzzle games to find where players get stuck or bored.`
      : "";
  return {
    title: "[For Hire] New puzzle levels for your game, tested before your players see them",
    content: `Need more levels for your puzzle game? Level AI designs levels in your game's style, and bots play every one before a person does, so each lands at the difficulty you asked for.${proof} Free sample set for your game: ${links.site}`,
    platforms: ["linkedin", "x", "threads", "bluesky", "reddit"],
  };
}

/** X allows 280 characters; trim the body (never the link) to fit. */
export function fitForX(content: string): string {
  if (content.length <= 280) return content;
  const link = content.match(/https?:\/\/\S+$/)?.[0] ?? "";
  const room = 280 - link.length - 2;
  return `${content.slice(0, room).replace(/\s+\S*$/, "")}… ${link}`.trim();
}

export async function postedToday(store: Store, platform: SocialPlatform, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const rows: ActivityEntry[] = await store.listActivity(500);
  return rows.filter((r) => r.agent === "marketing" && r.at >= since && r.action.startsWith("posted") && (r.result ?? "").includes(`[${platform}]`)).length;
}

export async function publish(args: {
  naive: NaiveClient;
  identityId: string;
  store: Store;
  post: Post;
  dailyCap: number;
  /** Wait between status checks after posting (tests pass 0). */
  pollMs?: number;
}): Promise<{ posted: SocialPlatform[]; skipped: Array<{ platform: SocialPlatform; reason: string }> }> {
  const posted: SocialPlatform[] = [];
  const skipped: Array<{ platform: SocialPlatform; reason: string }> = [];
  // Post only where an account is connected, so unconnected networks don't fill the log with failures.
  let connected: Set<string> | null = null;
  try {
    const accounts = await (args.naive.social as unknown as { accounts?: (id: string) => Promise<{ data?: Array<{ platform: string }> }> }).accounts?.(args.identityId);
    if (accounts?.data) connected = new Set(accounts.data.map((a) => a.platform));
  } catch {
    connected = null;
  }
  for (const platform of args.post.platforms) {
    if (connected && !connected.has(platform)) {
      skipped.push({ platform, reason: "no account connected" });
      continue;
    }
    if ((await postedToday(args.store, platform)) >= args.dailyCap) {
      skipped.push({ platform, reason: `daily cap of ${args.dailyCap} reached` });
      continue;
    }
    const content = platform === "x" ? fitForX(args.post.content) : args.post.content;
    try {
      const res = await args.naive.social.createPost(args.identityId, {
        content,
        title: args.post.title,
        platforms: [platform],
        ai_generated: true,
      });
      // "scheduled" only means accepted. Wait for the network's answer (seen Nov 7: X failed ~4 s later).
      let status = String(res.status);
      let error: string | null = null;
      const getPost = (args.naive.social as unknown as { getPost?: (i: string, p: string) => Promise<{ status: string; error?: string | null }> }).getPost;
      for (let i = 0; getPost && i < 6 && (status === "scheduled" || status === "processing"); i++) {
        await new Promise((r) => setTimeout(r, args.pollMs ?? 4000));
        const p = await getPost.call(args.naive.social, args.identityId, res.id).catch(() => null);
        if (p) { status = p.status; error = p.error ?? null; }
      }
      if (status === "failed") {
        skipped.push({ platform, reason: error ?? "the network rejected the post" });
        await args.store.logActivity({
          at: new Date().toISOString(), agent: "marketing", action: `couldn't post on ${platform}`,
          why: error ?? "the network rejected the post", result: `[${platform}] failed ${res.id}`, costUsd: null, human: false,
        });
        continue;
      }
      posted.push(platform);
      await args.store.logActivity({
        at: new Date().toISOString(), agent: "marketing", action: `posted on ${platform}: ${args.post.title}`,
        why: "find studios and teams who need levels or playtests", result: `[${platform}] ${status} ${res.id}`, costUsd: null, human: false,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
      skipped.push({ platform, reason });
      await args.store.logActivity({
        at: new Date().toISOString(), agent: "marketing", action: `couldn't post on ${platform}`, why: reason, result: `[${platform}] failed`, costUsd: null, human: false,
      });
    }
  }
  return { posted, skipped };
}
