import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  toolAuditGame,
  toolDraftOutreach,
  toolFindTargets,
  toolFinance,
  toolPaymentLink,
  toolPostUpdate,
  toolRecordReply,
  toolRunPlaytest,
  toolSaveLead,
  toolSendOutreach,
  toolSendReply,
  toolSetSample,
  type ToolContext,
} from "./tools.js";
import { PlanSchema } from "../mobile/plan.js";

/**
 * The business MCP server. Naïve agents add it as an MCP toolset (see src/agents/definitions.ts),
 * so each tool can be set to allow, ask, or deny per agent. Tool names are the contract.
 */
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export function buildMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "levelstudio-business", version: "0.1.0" });

  server.registerTool(
    "find_targets",
    {
      description:
        "Scan the top free puzzle games on Google Play and their newest reviews for level-design complaints (too easy, too hard, wants more levels, repetitive). Returns ranked targets with a checkable reason and example quotes. Costs about $0.002 of Monid credit per game.",
      inputSchema: { maxGames: z.number().int().min(1).max(15).optional() },
    },
    async (args) => json(await toolFindTargets(ctx, args)),
  );

  server.registerTool(
    "audit_game",
    {
      description: "Read one specific Google Play game's newest reviews and find level-design complaints. Use it for a studio you already know about. Costs about $0.002 of Monid credit.",
      inputSchema: { appId: z.string(), title: z.string(), developer: z.string() },
    },
    async (args) => json(await toolAuditGame(ctx, args)),
  );

  server.registerTool(
    "save_lead",
    {
      description: "Save a studio from find_targets as a lead, with a public business email if you found one. Also records it in the CRM.",
      inputSchema: {
        appId: z.string(),
        company: z.string(),
        email: z.email().optional(),
        contactName: z.string().optional(),
      },
    },
    async (args) => json(await toolSaveLead(ctx, args)),
  );

  server.registerTool(
    "list_leads",
    {
      description: "List leads, optionally by stage.",
      inputSchema: {
        stage: z.enum(["found", "sample_made", "emailed", "replied", "pilot_offered", "pilot_paid", "delivered", "lost", "opted_out"]).optional(),
      },
    },
    async (args) => json(await ctx.store.listLeads(args.stage)),
  );

  server.registerTool(
    "set_sample_url",
    {
      description: "Attach the playable sample pack made for this lead. Required before drafting outreach.",
      inputSchema: { leadId: z.string(), sampleUrl: z.url() },
    },
    async (args) => json(await toolSetSample(ctx, args)),
  );

  server.registerTool(
    "draft_outreach",
    {
      description:
        "Write the first email to a lead from its research and sample, and check it (opt-outs, daily cap, postal address, and every number must come from research). Returns a draftId. It doesn't send.",
      inputSchema: { leadId: z.string(), senderName: z.string() },
    },
    async (args) => json(await toolDraftOutreach(ctx, args)),
  );

  server.registerTool(
    "send_outreach",
    {
      description: "Send a checked draft by its draftId, exactly as drafted. Re-checks before sending. Sends only when outreach sending is turned on.",
      inputSchema: { draftId: z.string() },
    },
    async (args) => json(await toolSendOutreach(ctx, args)),
  );

  server.registerTool(
    "record_reply",
    {
      description: "Sales Reader only: record what a studio's reply says, its intent, and the next step. Updates the stage and the CRM.",
      inputSchema: {
        leadId: z.string(),
        summary: z.string().max(600),
        intent: z.enum(["interested", "question", "not_now", "not_interested"]),
        nextStep: z.string().max(300),
      },
    },
    async (args) => json(await toolRecordReply(ctx, args)),
  );

  server.registerTool(
    "send_reply",
    {
      description:
        "Answer a studio's reply in the same email thread. Write only your answer; our footer is added. Every number you state must come from the lead's research, the pilot size, or its price. Set includePaymentLink to add a pilot payment link at the team's price.",
      inputSchema: { leadId: z.string(), text: z.string().min(20).max(2000), includePaymentLink: z.boolean().optional() },
    },
    async (args) => json(await toolSendReply(ctx, args)),
  );

  server.registerTool(
    "create_payment_link",
    {
      description: "Create a Stripe payment link at the team's set price for a pilot pack (for a lead) or a hint pack. You can't set the price.",
      inputSchema: { leadId: z.string().nullable(), product: z.enum(["pilot_pack", "hint_pack"]) },
    },
    async (args) => json(await toolPaymentLink(ctx, args)),
  );

  server.registerTool(
    "finance_snapshot",
    {
      description: "Revenue, known spend by source, margin, and cost per accepted level. Sources that couldn't be read are listed as missing, never as zero.",
      inputSchema: { monidStartingUsd: z.number().nonnegative(), acceptedLevels: z.number().int().nonnegative().optional() },
    },
    async (args) => json(await toolFinance(ctx, args)),
  );

  server.registerTool(
    "run_playtest",
    {
      description:
        "Run a playtest plan on a real cloud phone with the Mobilerun agent and return a result for every planned level (loaded, touch OK, won, moves, visual issues).",
      inputSchema: { plan: PlanSchema, deviceId: z.string().optional() },
    },
    async (args) => json(await toolRunPlaytest(ctx, args)),
  );

  server.registerTool(
    "post_update",
    {
      description:
        "Marketing: publish a short 'for hire' post on Level AI's connected LinkedIn, X, Threads, Bluesky, and Reddit accounts. angle 'research' shares our live market research (reviews read, what players say about levels) with a free audit link; 'levels' offers puzzle levels for studios; 'playtest' offers an iPhone playtest of an app. Prefer 'research' when there's new research since the last post. Posts are labeled AI-generated, use only our own numbers, and are capped per network per day.",
      inputSchema: { angle: z.enum(["research", "levels", "playtest"]) },
    },
    async (args) => json(await toolPostUpdate(ctx, args)),
  );

  server.registerTool(
    "recent_activity",
    {
      description: "Read the newest business activity log lines: what each agent did, why, and the result.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    },
    async (args) => json(await ctx.store.listActivity(args.limit ?? 30)),
  );

  server.registerTool(
    "log_activity",
    {
      description: "Write one line to the company activity log: what you did, why, and the result.",
      inputSchema: { agent: z.string(), action: z.string(), why: z.string().optional(), result: z.string().optional() },
    },
    async (args) => {
      await ctx.store.logActivity({
        at: new Date().toISOString(), agent: args.agent, action: args.action,
        why: args.why ?? null, result: args.result ?? null, costUsd: null, human: false,
      });
      return json({ ok: true });
    },
  );

  return server;
}
