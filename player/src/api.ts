import { PRACTICE_LEVELS, type MatchLevel } from "./level.js";

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
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (res.status === 404 || res.status === 400) throw new NotFound(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * What to play, from the page's query string: ?level=<id>, ?pack=<id>, or nothing (the newest
 * agent-made levels, or the practice levels when none are published yet).
 */
export async function loadPlaylist(params: URLSearchParams): Promise<Playlist> {
  const level = params.get("level");
  const pack = params.get("pack");
  if (level) {
    return { title: null, levels: [await getJson<PublicLevel>(`/levels/${encodeURIComponent(level)}`)] };
  }
  if (pack) {
    const p = await getJson<{ name: string; levels: PublicLevel[] }>(`/packs/${encodeURIComponent(pack)}`);
    return { title: p.name, levels: p.levels };
  }
  const latest = await getJson<{ pack: { name: string } | null; levels: PublicLevel[] }>("/levels-latest?game=match3&limit=10");
  if (!latest.levels.length) return practicePlaylist();
  return { title: latest.pack?.name ?? "Free levels", levels: latest.levels };
}
