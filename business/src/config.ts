import { z } from "zod";

/**
 * Business-ops configuration, read once from the environment.
 *
 * Safety defaults: email sending is a dry run and billing refuses live Stripe keys until someone
 * turns them on explicitly. Nothing here prints secret values.
 */
const EnvSchema = z.object({
  // Data
  DATABASE_URL: z.string().optional(),

  // Naïve
  NAIVE_API_KEY: z.string().optional(),
  NAIVE_BASE_URL: z.string().default("https://api.vetta.sh"),
  /** The Sales Reader agent's id (agt_...), woken when a reply arrives. */
  SALES_READER_AGENT_ID: z.string().optional(),
  /** The "Level AI" Naïve identity that owns the connected social accounts. */
  NAIVE_IDENTITY_ID: z.string().optional(),
  /** Public website shown in posts. */
  SITE_URL: z.string().default("https://levelai.vercel.app"),
  /** At most this many posts per network per day. */
  SOCIAL_DAILY_CAP: z.coerce.number().int().positive().default(2),

  // Monid (CLI reads its own configured key; this is only checked for presence)
  MONID_API_KEY: z.string().optional(),

  // Mobilerun Cloud
  MOBILERUN_API_KEY: z.string().optional(),
  MOBILERUN_DEVICE_ID: z.string().optional(),
  MOBILERUN_MODEL: z.string().default("mobilerun/mobile-agent-fast"),

  // AgentMail
  AGENTMAIL_API_KEY: z.string().optional(),
  AGENTMAIL_INBOX_ID: z.string().optional(),
  AGENTMAIL_WEBHOOK_SECRET: z.string().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  BILLING_ALLOW_LIVE: z.enum(["0", "1"]).default("0"),

  // Prices are team decisions, so there are no defaults. Unset means "reply for details" and no link.
  PILOT_PRICE_USD: z.coerce.number().positive().optional(),
  /** Price of one phone playtest. Unset = playtests are free (no payment link). */
  PLAYTEST_PRICE_USD: z.coerce.number().positive().optional(),
  PILOT_LEVELS: z.coerce.number().int().positive().default(20),
  HINT_PACK_PRICE_USD: z.coerce.number().positive().optional(),

  // Outreach policy
  OUTREACH_SEND: z.enum(["0", "1"]).default("0"),
  OUTREACH_DAILY_CAP: z.coerce.number().int().positive().default(20),
  INBOUND_DAILY_CAP: z.coerce.number().int().positive().default(200),
  COMPANY_NAME: z.string().default("Level AI"),
  COMPANY_POSTAL_ADDRESS: z.string().optional(),
  PUBLIC_BASE_URL: z.string().default("http://localhost:8787"),
  /** A playable level to send with welcome emails. Falls back to DEMO_PLAY_URL (Max's hosted game). */
  SAMPLE_PLAY_URL: z.string().optional(),
  DEMO_PLAY_URL: z.string().optional(),
  /** Send the welcome email to people who sign up at our table. They opted in on the form. */
  INBOUND_AUTO_REPLY: z.enum(["0", "1"]).default("1"),

  // Server
  PORT: z.coerce.number().int().positive().default(8787),
  BUSINESS_MCP_TOKEN: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // A blank value (`KEY=` in a .env file, or a key a Neon deploy left empty) counts as unset,
  // so defaults apply instead of "" failing a number or enum check.
  const set = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  return EnvSchema.parse(set);
}

/** Which integrations are configured. Booleans only, so it's safe to log. */
export function integrationStatus(config: Config): Record<string, boolean> {
  return {
    database: Boolean(config.DATABASE_URL),
    naive: Boolean(config.NAIVE_API_KEY),
    monid: Boolean(config.MONID_API_KEY),
    mobilerun: Boolean(config.MOBILERUN_API_KEY),
    agentmail: Boolean(config.AGENTMAIL_API_KEY && config.AGENTMAIL_INBOX_ID),
    stripe: Boolean(config.STRIPE_SECRET_KEY),
    outreachSendingEnabled: config.OUTREACH_SEND === "1",
    billingLiveAllowed: config.BILLING_ALLOW_LIVE === "1",
  };
}
