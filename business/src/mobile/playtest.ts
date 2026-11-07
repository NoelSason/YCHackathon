import Mobilerun from "@mobilerun/sdk";
import { z } from "zod";
import { checkCompleteness, planToTask, PlanResultSchema, PlanSchema, type PlanInput, type PlanResult } from "./plan.js";

/**
 * Runs a Plan on a Mobilerun Cloud phone with the Mobilerun Agent (Tasks API) and returns checked,
 * structured results. Signatures checked against @mobilerun/sdk 6.1 on Nov 7, 2026:
 *   tasks.run({ deviceId, task, llmModel, maxSteps, outputSchema, recordingEnabled })
 *   tasks.getStatus(id) → { status, succeeded, message, output, steps }
 *
 * Note: claiming Mobilerun's hackathon credits starts a 72-hour clock. Claim only when ready.
 */
export interface PlaytestOutcome {
  taskId: string;
  status: string;
  succeeded: boolean;
  message: string | null;
  results: PlanResult | null;
  missingLevels: string[];
  steps: number | null;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export async function runPlan(args: {
  client: Mobilerun;
  deviceId: string;
  plan: PlanInput;
  model: string;
  pollMs?: number;
  timeoutMs?: number;
  /** Video capture. Off by default: some devices (our cloud iPhone) reject it with a 400. */
  recording?: boolean;
}): Promise<PlaytestOutcome> {
  const plan = PlanSchema.parse(args.plan);
  const outputSchema = z.toJSONSchema(PlanResultSchema) as Record<string, unknown>;
  const task = await args.client.tasks.run({
    deviceId: args.deviceId,
    task: planToTask(plan),
    llmModel: args.model,
    maxSteps: Math.min(200, 25 * plan.steps.length),
    outputSchema,
    recordingEnabled: args.recording ?? false,
  });

  const deadline = Date.now() + (args.timeoutMs ?? plan.limits.maxMinutes * 60_000 + 120_000);
  let status = await args.client.tasks.getStatus(task.id);
  while (!TERMINAL.has(status.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, args.pollMs ?? 4000));
    status = await args.client.tasks.getStatus(task.id);
  }

  const parsed = PlanResultSchema.safeParse(status.output);
  const results = parsed.success ? parsed.data : null;
  return {
    taskId: task.id,
    status: status.status,
    succeeded: Boolean(status.succeeded) && results !== null,
    message: status.message ?? null,
    results,
    missingLevels: results ? checkCompleteness(plan, results).missing : plan.steps.map((s) => String(s.level)),
    steps: status.steps ?? null,
  };
}

export function mobilerunClient(apiKey: string): Mobilerun {
  return new Mobilerun({ apiKey });
}
