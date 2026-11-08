import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { advanceTicks, applyAction, createGame, legalActions, statusOf } from "../engine/houseki-gem-swap/gem-swap/engine.js";
import type { GameState } from "../engine/houseki-gem-swap/gem-swap/types-state.js";
import type { Action } from "../engine/houseki-gem-swap/gem-swap/types-actions.js";

const htmlPath = fileURLToPath(new URL("./index.html", import.meta.url));
const levels = {
  meadow: { name: "Open Meadow", rows: ["########", "########", "########", "########", "########", "########", "########", "########"], seals: [18, 29, 34, 45], target: 12, moveLimit: 24 },
  blossom: { name: "Blossom Bowl", rows: ["..####..", ".######.", "########", "########", "########", "########", ".######.", "..####.."], seals: [19, 20, 35, 36], target: 12, moveLimit: 24 },
  bend: { name: "Winding Orchard", rows: ["##......", "####....", "######..", "..######", "....####", "....####", "......##", "......##"], seals: [37], target: 8, moveLimit: 35 },
} as const;
type LevelKey = keyof typeof levels;
let state: GameState;
let levelKey: LevelKey = "meadow";
function fresh(requestedLevel: unknown = "meadow") {
  levelKey = typeof requestedLevel === "string" && requestedLevel in levels ? requestedLevel as LevelKey : "meadow";
  const level = levels[levelKey];
  const mask = level.rows.flatMap((row) => [...row].map((cell) => cell === "#"));
  state = createGame({ width: 8, height: 8, mask, colourCount: 5, seed: `fruit-patch-${levelKey}-${Date.now()}`, tools: false, mode: "challenge", challenge: { goals: [{ kind: "collect", colour: "red", target: level.target }, { kind: "seals" }], moveLimit: level.moveLimit, seals: level.seals.map((cell) => ({ cell, layers: 1 })) } });
}
function settle() {
  for (let i = 0; i < 3600 && state.phase !== "ready" && state.phase !== "finished"; i++) state = advanceTicks(state, 1).state;
}
function view() {
  const status = statusOf(state);
  return { board: state.board.map((gem) => gem?.colour ?? null), mask: state.settings.mask, seals: state.seals, level: levelKey, levelName: levels[levelKey].name, width: state.settings.width, height: state.settings.height, moves: state.swapCount, moveLimit: state.challenge?.moveLimit, score: state.score, goal: status.goalProgress[0], blockerGoal: status.goalProgress[1], outcome: state.outcome };
}
fresh();
createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url === "/" && req.method === "GET") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(await readFile(htmlPath)); return; }
  if (req.url === "/api/state" && req.method === "GET") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(view())); return; }
  if (req.url === "/api/hint" && req.method === "GET") {
    const choices = legalActions(state).filter((action): action is Extract<Action, { kind: "swap" }> => action.kind === "swap");
    res.setHeader("Content-Type", "application/json");
    const move = choices.length ? choices[Math.floor(Math.random() * choices.length)] : null;
    const hintTransition = move ? applyAction(state, move) : null;
    const matchEvent = hintTransition?.events.find((event) => event.type === "match-marked");
    const matchedCells = matchEvent && Array.isArray(matchEvent.cells) ? matchEvent.cells : [];
    res.end(JSON.stringify(move ? { ...move, matchedCells } : null)); return;
  }
  if (req.url === "/api/new" && req.method === "POST") { let body = ""; for await (const chunk of req) body += chunk; const input = body ? JSON.parse(body) as { level?: unknown } : {}; fresh(input.level); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(view())); return; }
  if (req.url === "/api/swap" && req.method === "POST") {
    let body = ""; for await (const chunk of req) body += chunk;
    const { from, to } = JSON.parse(body) as { from: number; to: number };
    const transition = applyAction(state, { kind: "swap", from, to });
    res.setHeader("Content-Type", "application/json");
    if (!transition.accepted) { res.statusCode = 400; res.end(JSON.stringify({ error: transition.reason ?? "Swap rejected" })); return; }
    const matchEvent = transition.events.find((event) => event.type === "match-marked");
    const matchedCells = matchEvent && Array.isArray(matchEvent.cells) ? matchEvent.cells : [];
    state = transition.state; settle(); res.end(JSON.stringify({ ...view(), matchedCells })); return;
  }
  res.statusCode = 404; res.end("Not found");
}).listen(4173, "127.0.0.1", () => console.log("Gem Garden demo at http://127.0.0.1:4173"));
