-- Platform schema (Neon / Postgres). Owner: Abhinav. See platform/CONTRACTS.md.
-- Idempotent: safe to run repeatedly.

create extension if not exists pgcrypto;

-- ---------- games and levels ----------

create table if not exists games (
  game_id          text primary key,            -- 'match3', 'board', 'runner', 'stub'
  name             text not null,               -- our fork's own name
  bots             jsonb not null default '[]',
  default_win_rate numeric not null default 0.40,
  base_url         text,                        -- where the browser game is hosted
  created_at       timestamptz not null default now()
);

create table if not exists levels (
  level_id          uuid primary key default gen_random_uuid(),
  game_id           text not null references games(game_id),
  level             jsonb not null,
  target_win_rate   numeric not null,
  status            text not null default 'draft'
                    check (status in ('draft','solving','accepted','rejected','published')),
  measured_win_rate numeric,
  notes             text,
  parent_level_id   uuid references levels(level_id),
  created_by        text,                       -- agent name
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists levels_game_status on levels(game_id, status);

create table if not exists solver_runs (
  run_id       uuid primary key default gen_random_uuid(),
  level_id     uuid not null references levels(level_id),
  bots         jsonb not null,                  -- string[]
  runs_per_bot integer not null default 200,
  status       text not null default 'queued'
               check (status in ('queued','running','done','failed')),
  results      jsonb,                           -- { [bot]: { runs, wins, win_rate, avg_moves } }
  solvable     boolean,
  min_moves    integer,
  error        text,
  claimed_by   text,                            -- harness worker id
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists solver_runs_queue on solver_runs(status, created_at);

create table if not exists packs (
  pack_id      uuid primary key default gen_random_uuid(),
  game_id      text not null references games(game_id),
  name         text not null,
  level_ids    jsonb not null,                  -- uuid[] in order
  published_at timestamptz not null default now()
);

-- ---------- players ----------

create table if not exists player_events (
  id           bigserial primary key,
  ts           timestamptz not null default now(),
  game_id      text not null,
  level_id     uuid,
  session_id   text,
  type         text not null check (type in ('attempt','win','loss','quit')),
  moves_used   integer,
  time_seconds numeric
);
create index if not exists player_events_level on player_events(level_id, ts);

-- ---------- the logs the demo is built from ----------

create table if not exists activity_log (
  id         uuid primary key default gen_random_uuid(),
  ts         timestamptz not null default now(),
  agent      text not null,
  action     text not null,
  reason     text,
  result     text,
  cost_usd   numeric not null default 0,
  ref_kind   text,
  ref_id     text,
  session_id text
);
create index if not exists activity_log_ts on activity_log(ts);

create table if not exists decisions (
  id                  uuid primary key default gen_random_uuid(),
  ts                  timestamptz not null default now(),
  agent               text not null default 'ceo',
  saw                 text not null,
  options             jsonb not null default '[]',
  chose               text not null,
  why                 text not null,
  expected            text,
  cost_estimate_usd   numeric,
  cards               jsonb not null default '[]',
  result              text,
  matched_expectation boolean,
  resolved_at         timestamptz,
  session_id          text
);

create table if not exists interventions (
  id       uuid primary key default gen_random_uuid(),
  ts       timestamptz not null default now(),
  who      text not null,
  what     text not null,
  why      text not null,
  kind     text not null check (kind in ('approval','fix','kill','manual')),
  ref_kind text,
  ref_id   text
);

-- ---------- business (Noel's agents write here through the MCP tools) ----------

create table if not exists studios (
  studio_id     uuid primary key default gen_random_uuid(),
  name          text not null,
  domain        text,
  contact_email text,
  reason        text,                           -- why this target, checkable by a person
  stage         text not null default 'found'
                check (stage in ('found','sample_made','emailed','replied','pilot_paid','delivered')),
  source        text,                           -- 'research' | 'inbound_qr'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists studios_domain on studios(domain) where domain is not null;

create table if not exists emails (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  studio_id   uuid references studios(studio_id),
  direction   text not null check (direction in ('out','in')),
  subject     text,
  summary     text,
  external_id text
);

create table if not exists payments (
  id              uuid primary key default gen_random_uuid(),
  ts              timestamptz not null default now(),
  studio_id       uuid references studios(studio_id),
  product         text not null,                -- 'pilot_pack' | 'hint_pack'
  amount_usd      numeric not null,
  mode            text not null default 'test' check (mode in ('test','live')),
  stripe_id       text,
  payment_link_id text,
  status          text not null default 'created'
                  check (status in ('created','paid','delivered','refunded'))
);

-- ---------- ops ----------

create table if not exists settings (
  key   text primary key,
  value jsonb not null
);
insert into settings(key, value) values ('kill_switch', 'false') on conflict do nothing;

create table if not exists checks (
  id      uuid primary key default gen_random_uuid(),
  ts      timestamptz not null default now(),
  name    text not null,                        -- demo path, see master-plan "Demo readiness"
  owner   text not null,
  ok      boolean not null,
  detail  text
);

-- seed a stub game so agents can be built before the real adapters land
insert into games(game_id, name, bots, default_win_rate)
values ('stub', 'Stub game', '["random"]', 0.40)
on conflict do nothing;
