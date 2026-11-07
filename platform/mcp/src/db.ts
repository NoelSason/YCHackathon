import pg from "pg";

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  // Fail loudly at boot rather than on the first tool call overnight.
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

export const pool = new Pool({
  connectionString: url,
  max: 5,
  // Neon needs TLS; local Postgres usually doesn't. PGSSL=0 opts out.
  ssl: process.env.PGSSL === "0" ? undefined : { rejectUnauthorized: true },
});

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}
