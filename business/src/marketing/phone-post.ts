import { z } from "zod";
import type { ToolContext } from "../mcp/tools.js";
import { enqueue } from "../leads/playtest-offer.js";
import { activePhoneTask } from "../mobile/loop.js";
import { fitForX } from "./posts.js";

/**
 * Posts on X from the cloud iPhone, in Safari, when X refuses posts through the social API (seen
 * Nov 7: every API post from @uselevelai came back "failed" with no error). Noel logged in to x.com
 * in Safari on the phone himself; the agent never logs in or types a password. It runs in the same
 * queue as playtests, so it never fights a paid order for the phone.
 */
const ResultSchema = z.object({
  posted: z.boolean(),
  logged_in_as: z.string().nullable(),
  problem: z.string().nullable(),
});
type Result = z.infer<typeof ResultSchema>;
const TERMINAL = new Set(["completed", "failed", "cancelled", "stopped", "succeeded", "error", "timed_out"]);

export function phonePostTask(text: string): string {
  return [
    "Post one message on X from Safari. Rules: never log in, never type a password, never change settings, never like, follow, reply, or open messages.",
    "1. Open Safari and go to https://x.com/compose/post (if Safari shows a 'Open in app' banner, dismiss it and stay in Safari).",
    "If the page shows only the X logo on a black screen for more than 10 seconds, tap the reload arrow in the address bar and wait again (up to 3 reloads). If it never loads, report posted=false with problem 'x.com did not load'.",
    "2. If you are NOT logged in (you see a sign-in page), stop and report posted=false with problem 'not logged in'.",
    "3. Tap the text box and type exactly this text, character for character:",
    text,
    "4. Tap the Post button. Wait until the post is sent (the compose box closes or a 'Your post was sent' notice shows).",
    "5. As soon as you see it was sent, stop and report posted=true, with the account handle you saw in logged_in_as. Don't open any other page.",
  ].join("\n");
}

export async function postOnXFromPhone(
  ctx: ToolContext,
  text: string,
  opts: { pollMs?: number; timeoutMs?: number; waitMs?: number } = {},
): Promise<{ posted: boolean; problem: string | null; taskId: string | null }> {
  const client = ctx.mobilerun;
  const deviceId = ctx.config.MOBILERUN_DEVICE_ID;
  if (!client || !deviceId) return { posted: false, problem: "phone not configured", taskId: null };
  const body = fitForX(text);
  return enqueue(async () => {
    // Another task on the phone (an order from another server, a manual run): wait for it, up to
    // waitMs, instead of giving up, and say so in the log.
    const waitUntil = Date.now() + (opts.waitMs ?? 8 * 60_000);
    let busy = await activePhoneTask(client, deviceId).catch(() => null);
    if (busy) {
      await ctx.store.logActivity({
        at: new Date().toISOString(), agent: "marketing", action: "waiting for the iPhone to post on X",
        why: "another task is running on the phone", result: null, costUsd: null, human: false,
      });
    }
    while (busy && Date.now() < waitUntil) {
      await new Promise((r) => setTimeout(r, opts.pollMs ?? 5000));
      busy = await activePhoneTask(client, deviceId).catch(() => null);
    }
    if (busy) return { posted: false, problem: "phone busy", taskId: null };
    // The console shows this row as "Now posting on X" over the live phone view.
    await ctx.store.logActivity({
      at: new Date().toISOString(), agent: "marketing", action: "posting on X from the iPhone",
      why: body.slice(0, 160), result: null, costUsd: null, human: false,
    });
    const task = await client.tasks.run({
      deviceId,
      task: phonePostTask(body),
      llmModel: ctx.config.MOBILERUN_MODEL,
      maxSteps: 20,
      executionTimeout: 240,
      vision: true,
      outputSchema: z.toJSONSchema(ResultSchema) as Record<string, unknown>,
      recordingEnabled: false,
    } as never);
    const deadline = Date.now() + (opts.timeoutMs ?? 270_000);
    let s = await client.tasks.getStatus(task.id);
    while (!TERMINAL.has(String(s.status)) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, opts.pollMs ?? 5000));
      s = await client.tasks.getStatus(task.id);
    }
    if (!TERMINAL.has(String(s.status))) await client.tasks.stop(task.id).catch(() => undefined);
    const parsed = ResultSchema.safeParse((s as { output?: unknown }).output);
    // Posted: stay on X, where the sent notice shows (the profile page hangs on this phone's Safari,
    // Nov 8). Not posted: the home screen, never a stuck X splash or a sign-in page.
    if (!(parsed.success && parsed.data.posted)) await client.devices.actions.global(deviceId, { action: 2 }).catch(() => undefined);
    const r: Result | null = parsed.success ? parsed.data : null;
    const posted = Boolean(r?.posted);
    const problem = posted ? null : r?.problem ?? `phone task ${String(s.status)}`;
    await ctx.store.logActivity({
      at: new Date().toISOString(),
      agent: "marketing",
      action: posted ? `posted on x from the iPhone` : `couldn't post on x from the iPhone`,
      why: posted ? body.slice(0, 160) : problem,
      result: `[x] ${posted ? "posted" : "failed"} (phone task ${task.id})`,
      costUsd: null,
      human: false,
    });
    return { posted, problem, taskId: task.id };
  });
}
