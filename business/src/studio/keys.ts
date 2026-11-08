import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { ToolContext } from "../mcp/tools.js";
import { idempotencyKey } from "../outreach/send.js";

/**
 * Developer keys: a studio signs up on /developers, gets a key by email, and plugs Level AI into its
 * own coding agent through the studio MCP endpoint. Keys look like "lvl_<48 hex>" and are stored only
 * as SHA-256 hashes.
 */
export const DeveloperKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  studio: z.string().trim().min(1).max(160),
  consent: z.literal(true),
});

export const hashKey = (key: string): string => createHash("sha256").update(key).digest("hex");
export const newKey = (): string => `lvl_${randomBytes(24).toString("hex")}`;

export async function issueDeveloperKey(ctx: ToolContext, input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = DeveloperKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fill in your name, email, and studio, and tick the box." };
  const f = parsed.data;
  const lead = await ctx.store.upsertLead({
    company: f.studio, appId: null, contactName: f.name, email: f.email, source: "inbound_form", stage: "found",
    reason: "Asked for a developer key.", sampleUrl: null, crmContactId: null,
  });
  const key = newKey();
  await ctx.store.addApiKey(lead.id, hashKey(key));
  if (!ctx.mail) return { ok: false, error: "We couldn't email your key right now. Please try again in a minute." };
  const site = ctx.config.SITE_URL;
  const body = [
    `Hi ${f.name.split(" ")[0]},`,
    "",
    `Here's your ${ctx.config.COMPANY_NAME} developer key. Keep it private, like a password:`,
    "",
    key,
    "",
    "To connect your coding agent (for example, Claude Code):",
    `claude mcp add --transport http levelai ${site}/studio-mcp --header "Authorization: Bearer ${key}"`,
    "",
    "Then ask it to playtest your app on a real iPhone, read your game's newest reviews, or request free levels.",
    `Setup details: ${site}/developers`,
    "",
    ctx.config.COMPANY_NAME,
    "",
    "—",
    `${ctx.config.COMPANY_NAME} is a small studio where AI agents design and test levels, and this email was written by one of them. You're getting it because you asked for a developer key.`,
    ctx.config.COMPANY_POSTAL_ADDRESS ?? "",
    `Reply "stop" and we won't email you again.`,
  ].join("\n");
  const sent = await ctx.mail.send({ to: f.email, subject: `Your ${ctx.config.COMPANY_NAME} developer key`, text: body, idempotencyKey: idempotencyKey("dev-key", lead.id, hashKey(key)) });
  // The email body holds the key, so only a note is stored, never the key itself.
  await ctx.store.addOutreach({ leadId: lead.id, to: f.email, subject: `Your ${ctx.config.COMPANY_NAME} developer key`, body: "Developer key sent (not stored).", status: "sent", blockedReason: null, providerMessageId: sent.messageId });
  await ctx.store.logActivity({ at: new Date().toISOString(), agent: "sales", action: `issued a developer key to ${f.studio}`, why: "requested on the developers page", result: null, costUsd: null, human: false });
  return { ok: true };
}
