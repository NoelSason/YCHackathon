/**
 * Player events for the platform (platform/CONTRACTS.md §1): POST /events with
 * { game_id, level_id, session_id, type, moves_used?, time_seconds? }.
 *
 * One `attempt` when a player starts a level (their first touch on the board), then exactly one of
 * `win`, `loss`, or `quit`. Sent as text/plain so the browser skips the CORS preflight; the platform
 * parses the body as JSON regardless of content type. `keepalive` lets a `quit` survive closing the tab.
 *
 * The events URL comes from `data-events-url` on <main> in site/play.html.
 */
type EndType = "win" | "loss" | "quit";

function sessionId(): string {
  const fresh = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  try {
    const saved = localStorage.getItem("levelai.player");
    if (saved) return saved;
    const id = fresh();
    localStorage.setItem("levelai.player", id);
    return id;
  } catch {
    return fresh();
  }
}

export class Attempt {
  private startedAt = 0;
  private state: "idle" | "started" | "ended" = "idle";

  constructor(private readonly url: string | null, private readonly levelId: string, private readonly session = sessionId()) {}

  get inProgress(): boolean {
    return this.state === "started";
  }

  start(): void {
    if (this.state !== "idle") return;
    this.state = "started";
    this.startedAt = performance.now();
    this.send({ type: "attempt" });
  }

  end(type: EndType, movesUsed: number): void {
    if (this.state !== "started") return;
    this.state = "ended";
    this.send({ type, moves_used: movesUsed, time_seconds: Math.round((performance.now() - this.startedAt) / 100) / 10 });
  }

  private send(event: { type: string; moves_used?: number; time_seconds?: number }): void {
    if (!this.url) return;
    const body = JSON.stringify({ game_id: "match3", level_id: this.levelId, session_id: this.session, ...event });
    void fetch(this.url, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain;charset=UTF-8" } }).catch(() => undefined);
  }
}
