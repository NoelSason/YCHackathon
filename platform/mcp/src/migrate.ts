// Apply platform/db/schema.sql to DATABASE_URL. Idempotent.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "./db.js";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "..", "..", "db", "schema.sql"), "utf8");
await pool.query(sql);
console.log("schema applied");
await pool.end();
