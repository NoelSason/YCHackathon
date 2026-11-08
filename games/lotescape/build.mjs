import { build } from "esbuild";
import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await build({ entryPoints: ["ui/main.ts"], outfile: "dist/game.js", bundle: true, format: "esm", target: "es2022" });
const index = await readFile("dist/index.html", "utf8");
await writeFile("dist/index.html", index.replace("__PLATFORM_URL__", JSON.stringify(process.env.PLATFORM_URL ?? "")));
