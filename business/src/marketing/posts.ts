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
}

export async function gatherStats(store: Store): Promise<Stats> {
  const leads = await store.listLeads();
  return {
    studiosResearched: leads.filter((l) => l.source === "research").length,
    studiosEmailed: leads.filter((l) => ["emailed", "replied", "pilot_offered", "pilot_paid", "delivered"].includes(l.stage)).length,
    playtestsDelivered: leads.filter((l) => l.source === "inbound_form" && l.stage === "delivered" && (l.reason ?? "").startsWith("Ordered a phone playtest")).length,
  };
}

export type Angle = "levels" | "playtest";

export interface Post {
  title: string;
  content: string;
  platforms: SocialPlatform[];
}

/** One post per angle, written for people who hire help for their games. */
export function composePost(angle: Angle, stats: Stats, links: { site: string; playtest: string | null }): Post {
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
    content: `Need more levels for your puzzle game? Level AI designs levels in your game's style and plays each one hundreds of times until it hits the difficulty you want.${proof} Free sample set for your game: ${links.site}`,
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
}): Promise<{ posted: SocialPlatform[]; skipped: Array<{ platform: SocialPlatform; reason: string }> }> {
  const posted: SocialPlatform[] = [];
  const skipped: Array<{ platform: SocialPlatform; reason: string }> = [];
  for (const platform of args.post.platforms) {
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
      posted.push(platform);
      await args.store.logActivity({
        at: new Date().toISOString(), agent: "marketing", action: `posted on ${platform}: ${args.post.title}`,
        why: "find studios and teams who need levels or playtests", result: `[${platform}] ${res.status} ${res.id}`, costUsd: null, human: false,
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
