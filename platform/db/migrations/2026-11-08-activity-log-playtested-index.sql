-- Additive migration (Nov 8, 2026, Noel's overnight relay, neon focus). Not part of schema.sql's
-- bootstrap: CREATE INDEX CONCURRENTLY can't run inside a transaction, so apply this file on its own.
-- Applied to the live Neon database on Nov 8, ~6 AM UTC. Safe to re-run.
--
-- Serves the "playtests run" count behind GET /public-stats (business/src/store.ts publicCounts),
-- which filters activity_log on `action like 'playtested %'`. Measured with EXPLAIN ANALYZE on a
-- copy of activity_log scaled 15x (31,140 rows): 4.00 ms -> 0.79 ms. At today's ~2,000 rows the
-- query is 0.2 ms either way; the index is for overnight growth.
create index concurrently if not exists activity_log_playtested
  on activity_log (ts) where action like 'playtested %';
