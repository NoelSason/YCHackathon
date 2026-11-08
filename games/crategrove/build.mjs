import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
const html = await readFile("dist/index.html", "utf8");
await writeFile("dist/index.html", html.replace("__PLATFORM_URL__", JSON.stringify(process.env.PLATFORM_URL ?? "")));
await build({ entryPoints: ["ui/main.ts"], bundle: true, format: "esm", target: ["es2022", "safari14"], outfile: "dist/game.js" });
console.log(`Built Crate Grove in dist/ (platform events → ${process.env.PLATFORM_URL || "disabled"})`);
