import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const root = normalize(process.argv[2] ?? "dist");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    const candidate = normalize(join(root, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")));
    if (!candidate.startsWith(root) || !(await stat(candidate)).isFile()) throw new Error("not found");
    res.writeHead(200, { "content-type": types[extname(candidate)] ?? "application/octet-stream" });
    res.end(await readFile(candidate));
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(Number(process.env.PORT ?? 5179), "0.0.0.0", () => console.log(`Lot Escape at http://localhost:${process.env.PORT ?? 5179}`));
