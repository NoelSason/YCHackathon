// Bundles the function (and the Lot Escape code it wraps from ../games/lotescape) into api/generator.js.
import { build } from "../games/lotescape/node_modules/esbuild/lib/main.js";
await build({ entryPoints: ["src/entry.ts"], bundle: true, platform: "node", format: "esm", target: "node20", outfile: "api/generator.js", banner: { js: "// Built by sample-generator/build.mjs from src/. Don't edit by hand." } });
console.log("built api/generator.js");
