import type { ToolContext } from "../mcp/tools.js";
import type { PackDelivery, RunOptions } from "../levels/deliver-pack.js";
import { activeGeneratorFor, type Generator } from "./store.js";

/**
 * The bring-your-own-generator hook in level pack delivery (levels/deliver-pack.ts, runPackDelivery):
 * when the ordering studio registered its own generator for this genre, the pack is built by it
 * (generators/pack.ts) instead of our engine. Null otherwise, and the normal path runs unchanged.
 *
 * pack.ts imports the solver (outside src/), so like levels/pack-maker.ts it runs only from source
 * (tsx) and is loaded at run time here; that keeps `npm run build` working.
 */
export type ExternalRunner = (opts: RunOptions) => Promise<PackDelivery["state"]>;
type PackModule = { runExternalPackDelivery(ctx: ToolContext, d: PackDelivery, gen: Generator, opts: RunOptions): Promise<PackDelivery["state"]> };

export async function externalPackRunner(ctx: ToolContext, d: PackDelivery): Promise<ExternalRunner | null> {
  if (!ctx.db || !d.leadId) return null;
  const gen = await activeGeneratorFor(ctx.db, d.leadId, d.gameId);
  if (!gen) return null;
  const mod = (await import("./" + "pack.js")) as PackModule;
  return (opts) => mod.runExternalPackDelivery(ctx, d, gen, opts);
}
