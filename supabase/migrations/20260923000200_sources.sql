-- Sources and the raw information they produce.
-- Raw source items are never thrown away: they are the audit trail that lets
-- us answer "where did this come from?" and re-parse with a newer parser.

create table sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  organization text,
  source_type source_type not null,
  -- 100 = the utility itself, 80 = akimat/government, 70 = 109 hotline,
  -- 50 = verified local media, 20 = community. See packages/source-ranking.
  authority_level integer not null check (authority_level between 0 and 100),
  base_url text,
  -- connector implementation key, or 'manual' when the source cannot be
  -- safely automated and relies on the admin ingestion panel.
  adapter_type text not null,
  enabled boolean not null default true,
  poll_interval_seconds integer check (poll_interval_seconds is null or poll_interval_seconds >= 60),
  language text,
  supports_structured_data boolean not null default false,
  notes text,
  last_successful_fetch_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger sources_updated_at before update on sources for each row execute function set_updated_at();

create table source_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete restrict,
  external_id text,
  canonical_url text,
  title text,
  raw_text text not null,
  raw_html text,
  raw_json jsonb,
  language text,
  published_at timestamptz,
  source_updated_at timestamptz,
  fetched_at timestamptz not null default now(),
  content_hash text not null,
  parser_version text,
  processing_status processing_status not null default 'NEW',
  processing_error text,
  -- For media items that attribute information to another organisation:
  -- publisher is sources.name, reported authority is this.
  reported_authority text,
  submitted_by text,
  is_demo boolean not null default false
);
create unique index source_items_external_uq on source_items (source_id, external_id) where external_id is not null;
create unique index source_items_hash_uq on source_items (source_id, content_hash);
create index source_items_status_idx on source_items (processing_status, fetched_at desc);

create table source_fetch_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status fetch_run_status not null default 'RUNNING',
  items_found integer not null default 0,
  items_new integer not null default 0,
  error text,
  http_status integer,
  duration_ms integer
);
create index source_fetch_runs_source_idx on source_fetch_runs (source_id, started_at desc);

-- Provider response cache (weather, marine, places, geocoding, routing).
create table api_cache (
  provider text not null,
  key text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (provider, key)
);
create index api_cache_expires_idx on api_cache (expires_at);

-- Fixed-window rate limiter for public endpoints (Ask, search, geocoding,
-- anonymous writes). Keys are hashed; no raw IPs are stored.
create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
