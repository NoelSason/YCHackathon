/**
 * Level AI's HTML emails, in the website's look: a navy card on graph-paper blue, game-tile accent
 * colors, and pass/fail badges. Email clients ignore most CSS, so everything is inline styles and
 * tables, with system fonts (custom fonts don't load in Gmail). Every email still sends a plain-text
 * version alongside this.
 */
export const C = {
  page: "#eef1f8",
  navy: "#1b1e3d",
  panel: "#262a52",
  line: "#343a6b",
  text: "#f3f5fb",
  muted: "#a9b0d6",
  ink: "#1b1e3d",
  yellow: "#ffc93c",
  green: "#2ec4a0",
  red: "#ff6b5b",
  blue: "#4361ee",
  purple: "#8b5cf6",
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Turns bare https links in already-escaped text into links. */
const linkify = (escaped: string): string =>
  escaped.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:${C.yellow};text-decoration:underline">${u.replace(/^https?:\/\//, "")}</a>`);

export function text(s: string, opts: { color?: string; size?: number; weight?: number } = {}): string {
  return `<p style="margin:0 0 14px;font-family:${FONT};font-size:${opts.size ?? 16}px;line-height:1.55;color:${opts.color ?? C.text};font-weight:${opts.weight ?? 400}">${linkify(esc(s))}</p>`;
}

export function heading(s: string): string {
  return `<h1 style="margin:0 0 6px;font-family:${FONT};font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.5px;color:${C.text}">${esc(s)}</h1>`;
}

export function eyebrow(s: string, color = C.yellow): string {
  return `<span style="display:inline-block;margin:0 0 14px;padding:5px 11px;border-radius:999px;background:${color};color:${C.ink};font-family:${FONT};font-size:12px;font-weight:800;letter-spacing:0.3px">${esc(s)}</span>`;
}

/** A row with a label and a pass/fail/neutral badge, like the site's measurement panel. */
export function checkRow(label: string, value: string, state: "pass" | "fail" | "info"): string {
  const bg = state === "pass" ? C.green : state === "fail" ? C.red : C.line;
  const fg = state === "info" ? C.text : C.ink;
  const mark = state === "pass" ? "✓ " : state === "fail" ? "✕ " : "";
  return `<tr>
    <td style="padding:12px 0;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:15px;color:${C.text}">${esc(label)}</td>
    <td align="right" style="padding:12px 0;border-bottom:1px solid ${C.line}"><span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${bg};color:${fg};font-family:${FONT};font-size:13px;font-weight:800">${mark}${esc(value)}</span></td>
  </tr>`;
}

/** A small data table (e.g. a pack's curve: level, target, measured). Cells are text; `link` makes the last cell a link. */
export function table(headers: string[], rows: Array<{ cells: string[]; link?: string }>): string {
  const th = headers.map((h, i) => `<th align="${i ? "right" : "left"}" style="padding:8px 6px;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:12px;font-weight:800;letter-spacing:0.3px;color:${C.muted}">${esc(h)}</th>`).join("");
  const tr = rows.map((r) => `<tr>${r.cells.map((c, i) => {
    const last = i === r.cells.length - 1 && r.link;
    const inner = last ? `<a href="${esc(r.link!)}" style="color:${C.yellow};text-decoration:underline">${esc(c)}</a>` : esc(c);
    return `<td align="${i ? "right" : "left"}" style="padding:7px 6px;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:14px;color:${C.text}">${inner}</td>`;
  }).join("")}</tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel};border-radius:16px;margin:4px 0 18px;padding:8px 12px"><tr>${th}</tr>${tr}</table>`;
}

export function panel(inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel};border-radius:16px;margin:4px 0 18px"><tr><td style="padding:18px 20px">${inner}</td></tr></table>`;
}

export function rows(inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${inner}</table>`;
}

/** A big number with a caption, like "7 of 86" on the site. */
export function bigStat(value: string, caption: string, color = C.yellow): string {
  return `<div style="font-family:${FONT};font-size:44px;line-height:1;font-weight:900;color:${color};letter-spacing:-1px">${esc(value)}</div>
    <div style="margin:8px 0 0;font-family:${FONT};font-size:14px;line-height:1.45;color:${C.muted}">${esc(caption)}</div>`;
}

export function quote(s: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr>
    <td width="4" style="background:${C.purple};border-radius:4px"></td>
    <td style="padding:4px 0 4px 14px;font-family:${FONT};font-size:16px;line-height:1.5;font-style:italic;color:${C.text}">“${esc(s)}”</td>
  </tr></table>`;
}

/** A tile-style button. Email buttons are links styled as blocks. */
export function button(label: string, href: string, color = C.yellow): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td style="border-radius:12px;background:${color};box-shadow:0 4px 0 rgba(0,0,0,0.35)">
    <a href="${esc(href)}" style="display:inline-block;padding:13px 22px;font-family:${FONT};font-size:15px;font-weight:800;color:${C.ink};text-decoration:none;border-radius:12px">${esc(label)}</a>
  </td></tr></table>`;
}

export function code(s: string): string {
  return `<div style="margin:4px 0 16px;padding:14px 16px;border-radius:12px;background:#11132a;font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;color:${C.text};word-break:break-all">${esc(s)}</div>`;
}

/** The Level AI logo (three tiles with eyes). PNG, since most email clients don't show SVG. */
const LOGO = `<img src="https://levelai.vercel.app/logo.png" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px">`;

export function layout(args: { preheader: string; body: string; footerReason: string; companyName: string; postalAddress: string }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(args.companyName)}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(args.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
    <tr><td style="padding:0 6px 16px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td>${LOGO}</td>
        <td style="padding-left:10px;font-family:${FONT};font-size:18px;font-weight:900;color:${C.ink};letter-spacing:-0.3px">${esc(args.companyName)}</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:${C.navy};border-radius:22px;padding:28px 26px 10px;box-shadow:0 8px 0 rgba(27,30,61,0.18)">${args.body}</td></tr>
    <tr><td style="padding:18px 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#5d6488">
      ${esc(args.companyName)} is a small studio where AI agents play, design, and test games, with a human team behind them. This email was written by one of our agents. ${esc(args.footerReason)}<br>
      ${esc(args.postalAddress)}<br>
      Reply “stop” and we won’t email you again.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
