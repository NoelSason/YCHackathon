/**
 * The live phone view. The server fetches a fresh screenshot of the team's Mobilerun phone and
 * the page shows it about once a second. The API key never reaches the browser.
 *
 * It only reads screenshots of an existing device. It never provisions, resets, or releases one.
 * Docs: https://docs.mobilerun.ai/api-reference/screenshots/capture-a-device-screenshot.md
 */
const API = "https://api.mobilerun.ai/v1";
const MIN_INTERVAL_MS = 900;

export class PhoneView {
  private last: { png: Buffer; at: number } | null = null;
  private inflight: Promise<Buffer | null> | null = null;
  lastError: string | null = null;

  constructor(private apiKey: string | undefined, private deviceId: string | undefined) {}

  get configured(): boolean {
    return Boolean(this.apiKey && this.deviceId);
  }

  /** Newest screenshot, shared across viewers so several open tabs don't multiply API calls. */
  async screenshot(): Promise<Buffer | null> {
    if (!this.configured) return null;
    if (this.last && Date.now() - this.last.at < MIN_INTERVAL_MS) return this.last.png;
    this.inflight ??= this.fetchOne().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchOne(): Promise<Buffer | null> {
    try {
      const res = await fetch(`${API}/devices/${encodeURIComponent(this.deviceId!)}/screenshots?hideOverlay=true`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.lastError = `Screenshot failed with HTTP ${res.status}`;
        return this.last?.png ?? null;
      }
      // The docs say the body is a PNG; the OpenAPI spec says a JSON base64 string. Accept both.
      const type = res.headers.get("content-type") ?? "";
      let png: Buffer;
      if (type.includes("json")) {
        const body = (await res.json()) as unknown;
        const b64 = typeof body === "string" ? body : typeof body === "object" && body && "data" in body ? String((body as { data: unknown }).data) : "";
        png = Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      } else {
        png = Buffer.from(await res.arrayBuffer());
      }
      if (png.length === 0) throw new Error("Empty screenshot");
      this.last = { png, at: Date.now() };
      this.lastError = null;
      return png;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return this.last?.png ?? null;
    }
  }
}
