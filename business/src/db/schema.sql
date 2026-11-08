-- Business-ops additions to the platform schema (platform/db/schema.sql, owned by Abhinav).
-- Business ops writes to the platform's own tables (studios, emails, payments, activity_log,
-- interventions), so the dashboard, get_company_metrics, and the demo stage all see one truth.
-- This file only adds what business ops needs on top. It's additive and safe to re-run.
-- Apply after the platform schema:  psql "$DATABASE_URL" -f business/src/db/schema.sql

-- Studios: the extra fields outreach needs.
alter table studios add column if not exists app_id         text;
alter table studios add column if not exists contact_name   text;
alter table studios add column if not exists sample_url     text;
alter table studios add column if not exists crm_contact_id text;
create unique index if not exists studios_contact_email_key on studios (lower(contact_email)) where contact_email is not null;

-- Studios: three more stages (a pilot offered, a lost deal, an opt-out).
alter table studios drop constraint if exists studios_stage_check;
alter table studios add constraint studios_stage_check check (stage in (
  'found', 'sample_made', 'emailed', 'replied', 'pilot_offered', 'pilot_paid', 'delivered', 'lost', 'opted_out'
));

-- Payments: Stripe retries webhooks, so one row per Stripe event.
create unique index if not exists payments_stripe_id_key on payments (stripe_id) where stripe_id is not null;

-- Addresses that asked us to stop. Checked before every email.
create table if not exists biz_suppressions (
  email      text primary key,
  reason     text not null,
  created_at timestamptz not null default now()
);

-- Deliveries owed after a payment.
create table if not exists biz_deliveries (
  id         uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments (id),
  studio_id  uuid references studios (studio_id),
  status     text not null check (status in ('pending', 'delivered', 'failed')),
  detail     text,
  created_at timestamptz not null default now()
);

-- Studio API keys for the developer integration (studio MCP). Only hashes are stored.
create table if not exists biz_api_keys (
  key_hash   text primary key,
  studio_id  uuid not null references studios (studio_id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Market research: one row per store-chart pass by the outreach loop. Counts only, no review text.
create table if not exists biz_market_research (
  id                  uuid primary key default gen_random_uuid(),
  ts                  timestamptz not null default now(),
  chart               text not null,
  games_read          int not null,
  reviews_read        int not null,
  too_hard            int not null default 0,
  too_easy            int not null default 0,
  wants_more_levels   int not null default 0,
  repetitive          int not null default 0,
  games_with_evidence int not null default 0,
  top_game            text,
  top_reason          text
);

-- Playtest orders and their live watch links (/watch?o=<token>). The token is random (32 bytes,
-- base64url) and is the only key the public /watch-status and /watch-frame endpoints accept.
create table if not exists biz_playtest_orders (
  id          uuid primary key default gen_random_uuid(),
  watch_token text not null unique,
  studio_id   uuid not null references studios (studio_id),
  app_url     text not null,
  game_name   text not null,
  state       text not null default 'queued' check (state in ('queued', 'testing', 'finished', 'failed')),
  test_order  boolean not null default false,
  summary     jsonb,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);

-- Resume paid playtests after a restart (the run queue is in memory).
alter table biz_playtest_orders add column if not exists payment_id uuid;
alter table biz_playtest_orders add column if not exists focus text;

-- Monthly level subscriptions, one row per Stripe subscription. Renewals are payments rows;
-- this row only says whether the subscription is still running.
create table if not exists biz_subscriptions (
  stripe_subscription_id text primary key,
  studio_id    uuid references studios (studio_id),
  status       text not null default 'active' check (status in ('active', 'cancelled')),
  mode         text not null default 'test' check (mode in ('test', 'live')),
  game_url     text,
  difficulty   text,
  started_at   timestamptz not null default now(),
  cancelled_at timestamptz
);

-- Level packs owed after a payment (or a demo run), made and emailed by levels/deliver-pack.ts.
-- One row per delivery: a pack is one row; a month of the subscription is two (part 1 now, part 2
-- two weeks later). payment_id is null only for demo runs. The curve (a target win rate per level)
-- and the phone study it came from are kept with the row; pack_id is set before the pack is saved,
-- so a restart mid-save never makes a second pack.
create table if not exists biz_pack_deliveries (
  id               uuid primary key default gen_random_uuid(),
  payment_id       uuid references payments (id),
  part             int not null default 1,
  studio_id        uuid references studios (studio_id),
  plan             text not null check (plan in ('level_pack', 'subscription')),
  game_id          text not null,
  difficulty       text not null check (difficulty in ('easy', 'medium', 'hard')),
  levels_owed      int not null,
  studied_game     text,
  game_url         text,
  bundle_id        text,
  test_order       boolean not null default false,
  demo             boolean not null default false,
  state            text not null default 'queued' check (state in ('queued', 'working', 'delivered', 'partial', 'failed')),
  due_at           timestamptz not null default now(),
  study            jsonb,
  curve            jsonb,
  pack_id          uuid,
  levels_delivered int,
  detail           text,
  email_message_id text,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);
create unique index if not exists biz_pack_deliveries_payment_part on biz_pack_deliveries (payment_id, part) where payment_id is not null;
create index if not exists biz_pack_deliveries_queue on biz_pack_deliveries (state, due_at);
