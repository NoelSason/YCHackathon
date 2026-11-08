// A demo-readiness check. One file per check in src/checks/, exporting `default: Check`.
// Owners from docs/master-plan.md "Demo readiness". A check must finish in under 60 s and must
// never change state: read, fetch, query, compare. Return ok:false with a detail a human can act on.
import type pg from "pg";

export interface CheckContext {
  db: pg.Pool;
  platformUrl: string;          // the Neon Function base URL, no trailing slash
  bearer: string;               // MCP bearer
  expectRunning: boolean;       // EXPECT_RUNNING=1 after the 6 PM switch-on
  env: NodeJS.ProcessEnv;
}

export interface CheckResult {
  ok: boolean;
  detail: string;
}

export interface Check {
  name: string;                 // short slug, e.g. "ceo_decision"
  owner: "Abhinav" | "Pinara" | "Max" | "Noel";
  path: string;                 // the demo path it protects, from the master plan table
  run(ctx: CheckContext): Promise<CheckResult>;
}
