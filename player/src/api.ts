import { PRACTICE_LEVELS, type MatchLevel } from "./level.js";
import { productionId, resumePosition, seriesPosition } from "./series.js";

/** Response shapes of business/src/levels/public.ts. The site forwards these paths to it. */
export interface PublicLevel {
  level_id: string;
  game_id: string;
  level: MatchLevel;
  target_win_rate: number;
  measured_win_rate: number | null;
}

export interface Playlist {
  /** Set name shown above the level, or null for a single level. */
  title: string | null;
  levels: PublicLevel[];
  /** True for the built-in practice levels: not agent-made, so no player events are sent. */
  practice?: boolean;
  /** Verified catalog position immediately after this playlist, if it has one. */
  continuation?: number;
}

/** The built-in practice levels as a playlist, used while no agent-made level is published. */
export function practicePlaylist(): Playlist {
  return {
    title: "Practice levels",
    practice: true,
    levels: PRACTICE_LEVELS.map(({ id, ...level }) => ({
      level_id: `practice-${id}`,
      game_id: "match3",
      level,
      target_win_rate: 0,
      measured_win_rate: null,
    })),
  };
}

export class NotFound extends Error {}

async function getJson<T>(path: string): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  let res: Response;
  try { res = await fetch(path, { headers: { accept: "application/json" }, signal: controller.signal }); }
  finally { clearTimeout(timer); }
  if (res.status === 404 || res.status === 400) throw new NotFound(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

// The hosted platform also serves saved levels; it remains available if the laptop's list API fails.
const PLATFORM = "https://br-broad-violet-bem8cpy5-platform.compute.c-9.us-east-2.aws.neon.tech";
async function savedLevel(id: string): Promise<PublicLevel> {
  let value: PublicLevel;
  try { value = await getJson<PublicLevel>(`/levels/${encodeURIComponent(id)}`); }
  catch {
    const raw = await getJson<PublicLevel & { status?: string }>(`${PLATFORM}/levels/${encodeURIComponent(id)}`);
    if (raw.status && raw.status !== "accepted" && raw.status !== "published") throw new NotFound(id);
    // The platform's basic endpoint omits difficulty metadata; never invent a measurement.
    value = { ...raw, target_win_rate: raw.target_win_rate ?? 0, measured_win_rate: raw.measured_win_rate ?? null };
  }
  if (value.game_id !== "match3") throw new NotFound(id);
  return value;
}
async function continuation(level: PublicLevel | undefined): Promise<number | undefined> {
  const n = level ? await seriesPosition(level) : 0;
  return n && n < 1000 ? n + 1 : undefined;
}

/**
 * What to play, from the page's query string: ?level=<id>, ?pack=<id>, ?made_by=agents (the Designer
 * agent's newest accepted levels), or nothing (the newest
 * agent-made levels, or the practice levels when none are published yet).
 */
export async function loadPlaylist(params: URLSearchParams): Promise<Playlist> {
  const level = params.get("level");
  const pack = params.get("pack");
  if (level) {
    const saved = await savedLevel(level);
    return { title: null, levels: [saved], continuation: await continuation(saved) };
  }
  if (pack) {
    const p = await getJson<{ name: string; levels: PublicLevel[] }>(`/packs/${encodeURIComponent(pack)}`);
    return { title: p.name, levels: p.levels, continuation: await continuation(p.levels.at(-1)) };
  }
  if (params.get("made_by") === "agents") {
    const agents = await getJson<{ pack: unknown; levels: PublicLevel[] }>("/levels-latest?game=match3&limit=10&made_by=agents");
    // A server without made_by answers with its pack; never label those levels as the agents'.
    if (agents.pack === null && agents.levels.length) return { title: "Newest from our design agents", levels: agents.levels };
  }
  if (params.get("made_by") !== "agents") {
    const requested = params.get("series");
    const n = requested === null ? resumePosition() : Number(requested);
    const id = await productionId(n);
    try {
      const saved = await savedLevel(id);
      if (await seriesPosition(saved) !== n) throw new Error("Garden catalog identity mismatch");
      return { title: `Verified Garden ${n}`, levels: [saved], continuation: n < 1000 ? n + 1 : undefined };
    } catch (e) {
      if (requested !== null) throw e; // do not silently show the wrong requested level
      // Keep the existing latest/practice fallback while the catalog is unavailable.
    }
  }
  const latest = await getJson<{ pack: { name: string } | null; levels: PublicLevel[] }>("/levels-latest?game=match3&limit=10");
  if (!latest.levels.length) return practicePlaylist();
  return { title: latest.pack?.name ?? "Free levels", levels: latest.levels };
}
