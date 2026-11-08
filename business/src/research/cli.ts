/**
 * Runs the Research step by hand: `npm run research -- --max 5`.
 * Spends Monid credit: about $0.00015 for the chart, plus about $0.0015 per game.
 */
import { MonidCli } from "./monid.js";
import { findTargets } from "./targets.js";

const maxArg = process.argv.indexOf("--max");
const maxGames = maxArg > -1 ? Number(process.argv[maxArg + 1]) : 5;

const targets = await findTargets(new MonidCli(), { maxGames });
for (const t of targets) {
  console.log(`\n${t.score.toFixed(1)}  ${t.appTitle} (${t.developer})`);
  console.log(`  ${t.reason}`);
  for (const ex of t.examples) console.log(`  · "${ex.quote}"`);
}
console.log(`\n${targets.length} targets from ${maxGames} games.`);
