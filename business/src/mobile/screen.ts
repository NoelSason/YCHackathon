import { inflateSync } from "node:zlib";
import type Mobilerun from "@mobilerun/sdk";

/**
 * Is the phone showing something, or a blank page? Checked on a real screenshot, not the agent's
 * word: on Nov 7 the phone agent "played" Water Sort from the accessibility tree while Safari showed
 * a plain white page, so the projector showed nothing.
 *
 * A screen counts as blank when one flat color covers almost all of the content area (the middle of
 * the screen, skipping the status bar and Safari's toolbar). Decodes 8- and 16-bit RGB/RGBA PNGs (the phone sends 16-bit RGB) with
 * node:zlib, no image library.
 */

/** `data` is unfiltered rows; each sample is `bytes` wide (1 for 8-bit, 2 for 16-bit, high byte first). */
interface Pixels { width: number; height: number; channels: number; bytes: number; data: Uint8Array }

export function decodePng(buf: Uint8Array): Pixels | null {
  const b = Buffer.from(buf);
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) return null;
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString("ascii", pos + 4, pos + 8);
    const body = b.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      bitDepth = body[8]!; colorType = body[9]!; interlace = body[12]!;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!width || !height || (bitDepth !== 8 && bitDepth !== 16) || !channels || interlace !== 0) return null;
  const bytes = bitDepth / 8;
  const bpp = channels * bytes;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp]! : 0;
      const up = y > 0 ? out[row - stride + x]! : 0;
      const c = x >= bpp && y > 0 ? out[row - stride + x - bpp]! : 0;
      const v = raw[src + x]!;
      let r: number;
      if (filter === 0) r = v;
      else if (filter === 1) r = v + a;
      else if (filter === 2) r = v + up;
      else if (filter === 3) r = v + ((a + up) >> 1);
      else {
        const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      }
      out[row + x] = r & 0xff;
    }
  }
  return { width, height, channels, bytes, data: out };
}

/** Share of the content area covered by its single most common (coarsely binned) color, 0 to 1. */
export function flatShare(png: Uint8Array): number | null {
  const img = decodePng(png);
  if (!img) return null;
  const counts = new Map<number, number>();
  let n = 0;
  const y0 = Math.floor(img.height * 0.12), y1 = Math.floor(img.height * 0.85);
  const step = Math.max(1, Math.floor(img.width / 120));
  for (let y = y0; y < y1; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * img.channels * img.bytes;
      const ch = (k: number) => img.data[i + k * img.bytes]! >> 4;
      const key = (ch(0) << 8) | (ch(1) << 4) | ch(2);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      n++;
    }
  }
  return n ? Math.max(...counts.values()) / n : null;
}

/** A blank page: one flat color over at least this share of the content area. */
export const BLANK_SHARE = 0.985;

export function isBlank(png: Uint8Array): boolean {
  const share = flatShare(png);
  return share === null ? false : share >= BLANK_SHARE;
}

/** A fresh PNG of the phone screen, or null. The API has answered with raw PNG; the spec says base64 JSON, so both are read. */
export async function captureScreen(client: Mobilerun, deviceId: string): Promise<Uint8Array | null> {
  try {
    const res = await client.devices.screenshots.capture(deviceId, { hideOverlay: true }).asResponse();
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("json")) {
      const body = (await res.json()) as unknown;
      const b64 = typeof body === "string" ? body : typeof body === "object" && body && "data" in body ? String((body as { data: unknown }).data) : "";
      const png = Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      return png.length ? png : null;
    }
    const png = new Uint8Array(await res.arrayBuffer());
    return png.length ? png : null;
  } catch {
    return null;
  }
}
