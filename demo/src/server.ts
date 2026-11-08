import { createServer, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { timingSafeEqual } from "node:crypto";
import { loadOutreach } from "./outreach.js";
import { computeStats, type StageEvent } from "./events.ts";
import { DEFAULT_ACTIVITY, DEFAULT_STEPINS, LiveFeed, ReplayFeed, SampleFeed, parseTables, type Feed, type HealthItem, type Pipeline } from "./feeds.ts";
import { PhoneView } from "./phone.ts";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(here, "..");
const repoDir = resolve(demoDir, "..");

// Env: the repo's .env first, then demo/.env and business/.env if they exist. Values are never printed.
for (const file of [join(repoDir, ".env"), join(demoDir, ".env"), join(repoDir, "business", ".env")]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

// ---- Arguments ------------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const checkOnly = flag("--check");
const port = Number(option("--port") ?? process.env.DEMO_PORT ?? 4545);
const replayFile = option("--replay");
const env = process.env;

function makeFeed(): Feed {
  if (flag("--sample")) return new SampleFeed();
  if (replayFile) return new ReplayFeed(resolve(process.cwd(), replayFile), Number(env.DEMO_REPLAY_SECONDS ?? 90));
  const tables = [
    ...parseTables(env.DEMO_ACTIVITY_TABLES ?? DEFAULT_ACTIVITY, false),
    ...parseTables(env.DEMO_STEPIN_TABLES ?? DEFAULT_STEPINS, true),
  ];
  return new LiveFeed(env.DATABASE_URL, tables);
}

const feed = makeFeed();
const phone = new PhoneView(env.MOBILERUN_API_KEY, env.MOBILERUN_DEVICE_ID);
const playUrl = env.DEMO_PLAY_URL ?? null;
/** The signup page ("Become a customer"): the business server's /join, usually behind a tunnel. */
const joinUrl = env.DEMO_JOIN_URL ?? null;
const company = env.COMPANY_NAME ?? "Level Studio";

// ---- State ----------------------------------------------------------------------------------

const MAX_EVENTS = 50_000;
const events: StageEvent[] = [];
let pipeline: Pipeline | null = null;
let playUrlOk: boolean | null = null;

function health(): HealthItem[] {
  const items = [...feed.health()];
  items.push(
    phone.configured
      ? { name: "Phone", ok: phone.lastError === null, detail: phone.lastError ?? "Screenshots arriving" }
      : { name: "Phone", ok: false, detail: "Set MOBILERUN_API_KEY and MOBILERUN_DEVICE_ID to show the phone." },
  );
  items.push(
    playUrl
      ? { name: "Play link", ok: playUrlOk !== false, detail: playUrlOk === false ? `${playUrl} didn't load` : playUrl }
      : { name: "Play link", ok: false, detail: "Set DEMO_PLAY_URL to show the QR code." },
  );
  return items;
}

function snapshot(limit = 150) {
  return {
    mode: feed.mode,
    banner: feed.banner,
    company,
    clock: feed.clock(),
    clockTicks: feed.clockTicks,
    stats: computeStats(events),
    events: events.slice(-limit),
    stepIns: events.filter((e) => e.human).slice(-6),
    pipeline,
    health: health(),
    phone: phone.configured,
    playUrl,
    joinUrl,
  };
}

// ---- Live updates (server-sent events) --------------------------------------------------------

const clients = new Set<ServerResponse>();

function broadcast(payload: unknown): void {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(data);
}

async function tick(): Promise<void> {
  try {
    const fresh = await feed.tick();
    if (fresh.length) {
      events.push(...fresh);
      events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
      broadcast({ type: "events", events: fresh.slice(-100), stats: computeStats(events), clock: feed.clock() });
    }
  } catch (err) {
    console.error("Feed error:", err instanceof Error ? err.message : err);
  }
}

async function slowTick(): Promise<void> {
  pipeline = await feed.pipeline();
  if (playUrl) {
    try {
      const r = await fetch(playUrl, { method: "GET", signal: AbortSignal.timeout(5000) });
      playUrlOk = r.ok;
    } catch {
      playUrlOk = false;
    }
  }
  broadcast({ type: "status", pipeline, health: health(), clock: feed.clock() });
}

// ---- Preflight --------------------------------------------------------------------------------

async function preflight(): Promise<HealthItem[]> {
  await tick();
  if (phone.configured) await phone.screenshot();
  await slowTick();
  return health();
}

function printHealth(items: HealthItem[]): void {
  console.log("");
  for (const h of items) console.log(`  ${h.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[33m✗\x1b[0m"} ${h.name.padEnd(22)} ${h.detail}`);
  const s = computeStats(events);
  console.log(`\n  ${s.agentActions} agent actions, ${s.decisions} decisions, ${s.stepIns} human step-ins in the log.\n`);
}

// ---- HTTP -------------------------------------------------------------------------------------

const page = (): string => readFileSync(join(demoDir, "public", "index.html"), "utf8");

/**
 * Password for the public console. Set DEMO_PASSWORD and every request needs HTTP Basic auth (any
 * username, that password). Unset = open, which is fine on localhost only.
 */
const password = env.DEMO_PASSWORD ?? "";
function authorized(req: import("node:http").IncomingMessage): boolean {
  if (!password) return true;
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? "");
  if (!m) return false;
  const pass = Buffer.from(m[1]!, "base64").toString("utf8").split(":").slice(1).join(":");
  const a = Buffer.from(pass), b = Buffer.from(password);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!authorized(req)) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="Level AI console", charset="UTF-8"', "content-type": "text/plain" });
    res.end("Level AI console: password required.");
    return;
  }
  try {
    switch (url.pathname) {
      case "/":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(page());
        return;
      case "/outreach":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(readFileSync(join(demoDir, "public", "outreach.html"), "utf8"));
        return;
      case "/api/outreach": {
        const board = await loadOutreach(env.DATABASE_URL);
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(board));
        return;
      }
      case "/api/state":
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(snapshot()));
        return;
      case "/api/stream":
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(": connected\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      case "/api/phone.png": {
        const png = await phone.screenshot();
        if (!png) {
          res.writeHead(204, { "cache-control": "no-store" });
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        res.end(png);
        return;
      }
      case "/api/join-qr.svg": {
        if (!joinUrl) {
          res.writeHead(404);
          res.end();
          return;
        }
        const svg = await QRCode.toString(joinUrl, { type: "svg", margin: 1, color: { dark: "#0b0d10", light: "#ffffff" } });
        res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "max-age=60" });
        res.end(svg);
        return;
      }
      case "/api/qr.svg": {
        if (!playUrl) {
          res.writeHead(404);
          res.end();
          return;
        }
        const svg = await QRCode.toString(playUrl, { type: "svg", margin: 1, color: { dark: "#0b0d10", light: "#ffffff" } });
        res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "max-age=60" });
        res.end(svg);
        return;
      }
      default:
        res.writeHead(404);
        res.end("Not found");
    }
  } catch (err) {
    res.writeHead(500);
    res.end(err instanceof Error ? err.message : "Error");
  }
});

function openWindow(target: string): void {
  if (process.platform !== "darwin") return;
  const chrome = "/Applications/Google Chrome.app";
  const cmd = existsSync(chrome)
    ? ["-na", "Google Chrome", "--args", `--app=${target}`, "--start-fullscreen"]
    : [target];
  spawn("open", cmd, { detached: true, stdio: "ignore" }).unref();
}

// ---- Main -------------------------------------------------------------------------------------

const label = { live: "LIVE from the activity log", replay: "REPLAY of a recorded run", sample: "SAMPLE DATA (rehearsal only)" }[feed.mode];
console.log(`\n  Demo stage · ${label}`);
const items = await preflight();
printHealth(items);

if (checkOnly) {
  // Used by the demo-readiness checks: the stage has a log to show and the phone view works.
  const required = items.filter((h) => h.name === "Database" || h.name.startsWith("Log:") || h.name === "Phone" || h.name === "Replay file");
  const anyLog = items.some((h) => (h.name.startsWith("Log:") || h.name === "Replay file") && h.ok);
  const ok = anyLog && required.filter((h) => !h.name.startsWith("Log:")).every((h) => h.ok);
  console.log(ok ? "  Stage check passed." : "  Stage check failed. Fix the items marked ✗ above.");
  process.exit(ok ? 0 : 1);
}

setInterval(() => void tick(), 2000);
setInterval(() => void slowTick(), 10_000);
setInterval(() => broadcast({ type: "ping", clock: feed.clock() }), 15_000);

server.listen(port, () => {
  const target = `http://localhost:${port}`;
  console.log(`  Stage: ${target}   (F: full screen, D: setup details, Ctrl+C: stop)\n`);
  if (flag("--open")) openWindow(target);
});
