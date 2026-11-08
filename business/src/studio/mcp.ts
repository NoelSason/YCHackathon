import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../mcp/tools.js";
import type { Lead } from "../types.js";
import { createPlaytestOrder } from "../leads/playtest-offer.js";
import { runLiveSignup } from "../leads/live.js";
import { appIdFromStoreUrl } from "../leads/intake.js";
import { fetchRecentReviews, storeName } from "../research/monid.js";
import { buildTarget } from "../research/targets.js";
import { status as progressStatus, step } from "../leads/progress.js";

/**
 * The studio MCP: what a studio's own coding agent can ask Level AI to do, authenticated by that
 * studio's developer key. Every call is scoped to that studio and logged.
 */
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export function buildStudioMcp(ctx: ToolContext, studio: Lead): McpServer {
  const server = new McpServer({ name: "levelai", version: "0.1.0" });
  const log = (action: string, why: string | null) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent: "studio-api", action: `${studio.company}: ${action}`, why, result: null, costUsd: null, human: false });

  server.registerTool(
    "request_playtest",
    {
      description: "Play your app on a real iPhone like a first-time user and email you a report (what loads, what breaks, where people get stuck). Takes about 10 minutes. Returns a request id for get_status.",
      inputSchema: { appUrl: z.url(), focus: z.string().max(400).optional() },
    },
    async (args) => {
      await log("requested a playtest", args.appUrl);
      const r = await createPlaytestOrder(ctx, {
        name: studio.contactName ?? studio.company, email: studio.email, team: studio.company, appUrl: args.appUrl, focus: args.focus, consent: true,
      });
      return json(r.ok ? { requestId: r.lead.id, paymentUrl: r.payUrl, status: r.payUrl ? "waiting for payment" : "queued" } : { error: r.error });
    },
  );

  server.registerTool(
    "audit_reviews",
    {
      description: "Read your game's newest Google Play or App Store reviews and report where players say it's too easy, too hard, repetitive, or out of levels, with example quotes.",
      inputSchema: { storeUrl: z.url(), gameName: z.string().max(120).optional() },
    },
    async (args) => {
      const appId = appIdFromStoreUrl(args.storeUrl);
      if (!appId) return json({ error: "Use a Google Play or App Store link to your game." });
      if (!ctx.monid) return json({ error: "Review reading isn't available right now." });
      await log("asked for a review audit", args.storeUrl);
      const reviews = await fetchRecentReviews(ctx.monid, appId);
      const t = buildTarget({ appId, title: args.gameName ?? studio.company, developer: studio.company, rating: null, downloads: null }, reviews);
      return json({ store: storeName(appId), reviewsRead: t.reviewsAnalyzed, summary: t.reason, counts: t.signalCounts, examples: t.examples.map((e) => e.quote) });
    },
  );

  server.registerTool(
    "request_free_levels",
    {
      description: "Ask for a free sample set of levels for your game. We read your players' reviews first (if you give a store link) and email you what we found and your free levels. Returns a request id for get_status.",
      inputSchema: { gameName: z.string().max(120), storeUrl: z.url().optional() },
    },
    async (args) => {
      await log("asked for free levels", args.gameName);
      const lead = await ctx.store.upsertLead({ ...studio, appId: appIdFromStoreUrl(args.storeUrl) ?? studio.appId });
      step(lead.id, "Got it. Starting now");
      void runLiveSignup(ctx, lead, args.gameName).catch(() => undefined);
      return json({ requestId: lead.id, status: "started" });
    },
  );

  server.registerTool(
    "get_status",
    {
      description: "Check on a request by its id: each step so far, and whether it's done.",
      inputSchema: { requestId: z.string() },
    },
    async (args) => json(progressStatus(args.requestId)),
  );

  return server;
}
