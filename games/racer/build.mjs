// Builds the browser game into dist/ (static files: index.html, style.css, app.js).
// PLATFORM_URL sets where player events go and where ?level=<id> is loaded from.
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const PLATFORM_URL =
  process.env.PLATFORM_URL ?? "https://br-broad-violet-bem8cpy5-platform.compute.c-9.us-east-2.aws.neon.tech";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await build({
  entryPoints: ["ui/main.ts"],
  bundle: true,
  format: "esm",
  target: ["es2020", "safari14"],
  minify: true,
  sourcemap: true,
  outfile: "dist/app.js",
  define: { __PLATFORM_URL__: JSON.stringify(PLATFORM_URL) },
  logLevel: "warning",
});
console.log(`built dist/ (events → ${PLATFORM_URL})`);
