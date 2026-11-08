import { z } from "zod";

/**
 * The plan and result shapes for phone work (the "playtest tool" contract in docs/master-plan.md).
 * Our agents write a Plan; the Mobilerun agent carries it out on a cloud phone and returns results
 * matching LevelResultSchema, which we pass to Mobilerun as `outputSchema`.
 */
export const PlanStepSchema = z.object({
  level: z.union([z.number().int(), z.string()]),
  /** How to open the level: a URL for our web games, or a deep link or menu path in a studio app. */
  open: z.string().min(1),
  attempts: z.number().int().min(1).max(5).default(1),
});

export const PlanSchema = z.object({
  planId: z.string().min(1),
  app: z.object({
    platform: z.enum(["ios", "android"]),
    /** Android package name, iOS bundle id, or "safari" / "chrome" for a web game. */
    package: z.string().min(1),
    /** The app's name as shown on the home screen, for installed apps. */
    label: z.string().optional(),
    build: z.string().optional(),
  }),
  goal: z.string().min(1),
  steps: z.array(PlanStepSchema).min(1).max(20),
  report: z.array(z.string()).default(["loaded", "touch_ok", "visual_issues", "won", "moves_used", "notes"]),
  limits: z.object({
    maxMinutes: z.number().int().min(1).max(60).default(15),
    never: z.array(z.string()).default(["purchases", "sign-ins", "sharing", "clicking ads", "granting permissions"]),
  }),
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlanInput = z.input<typeof PlanSchema>;

export const LevelResultSchema = z.object({
  level: z.string(),
  loaded: z.boolean(),
  touchOk: z.boolean(),
  won: z.boolean().nullable(),
  /** Plain number, not .int(): zod emits .int().nullable() as anyOf, which Mobilerun's outputSchema rejects. */
  movesUsed: z.number().nullable(),
  visualIssues: z.array(z.string()),
  stuckReason: z.string().nullable(),
  notes: z.string(),
});

export const PlanResultSchema = z.object({
  results: z.array(LevelResultSchema),
});

export type LevelResult = z.infer<typeof LevelResultSchema>;
export type PlanResult = z.infer<typeof PlanResultSchema>;

/** The plain-words instruction the Mobilerun agent follows. */
export function planToTask(plan: Plan): string {
  const steps = plan.steps
    .map((s, i) => `${i + 1}. Level ${s.level}: open it with "${s.open}". Play it ${s.attempts} time(s). Each time, keep playing until you win, run out of moves, or have made at least 15 moves, and count every move.`)
    .join("\n");
  const opener =
    plan.app.package === "safari" || plan.app.package === "chrome"
      ? `Use the ${plan.app.package === "safari" ? "Safari" : "Chrome"} browser. To open a URL, tap the address bar, type it, and press Go.`
      : `Use the app ${plan.app.label ? `"${plan.app.label}" (on the home screen; tap its icon to open it)` : plan.app.package}.`;
  return [
    `Goal: ${plan.goal}`,
    opener,
    "Steps:",
    steps,
    "",
    `In the results, set "level" to exactly the level value shown above (for example "${plan.steps[0]?.level ?? 1}"), with no extra words.`,
    "For each level, report whether it loaded, whether taps and swipes worked, whether you won, how many moves you used, anything that looked broken (cut-off text, overlapping pieces, blank screen), and, if you got stuck, why.",
    `Never do any of these: ${plan.limits.never.join(", ")}. If a screen asks for any of them, close it or go back.`,
    `Stop after ${plan.limits.maxMinutes} minutes even if you aren't done, and report what you finished.`,
  ].join("\n");
}

/** Every planned level must come back with a result or be reported missing. */
export function checkCompleteness(plan: Plan, result: PlanResult): { missing: string[] } {
  const got = new Set(result.results.map((r) => levelKey(r.level)));
  return { missing: plan.steps.map((s) => String(s.level)).filter((l) => !got.has(levelKey(l))) };
}

/** The phone agent sometimes labels a result "Level 1" for planned level 1; match those. */
function levelKey(level: string | number): string {
  return String(level).trim().toLowerCase().replace(/^level\s*/, "");
}
