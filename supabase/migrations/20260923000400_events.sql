-- The canonical city event model. Every source — HTML article, official API,
-- admin paste, weather threshold — is normalised into these tables.
-- Only reviewed/approved information becomes a city_event; extraction output
-- waits in event_candidates until then.

create table city_events (
  id uuid primary key default gen_random_uuid(),
  category event_category not null,
  event_type text not null,              -- planned_outage, emergency_outage, road_closure, wind_advisory, ...
  title text not null,                   -- source-language headline; UI localises from category/type
  summary text,
  status event_status not null,
  severity event_severity not null default 'MINOR',
  starts_at timestamptz,
  expected_ends_at timestamptz,          -- NULL = not announced. Never invented.
  actual_ends_at timestamptz,
  reason text,
  official_eta boolean not null default false,
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  verification_status verification_status not null,
  advisory_origin advisory_origin,
  -- Organisation the information is attributed to (e.g. 'AUES' when Lada.kz
  -- reports an AUES announcement). Publisher is the primary source.
  reported_authority text,
  primary_source_id uuid not null references sources(id),
  created_from_source_item_id uuid references source_items(id),
  -- Verbatim fragments kept next to the absolute values we derived from them.
  time_text text,
  location_text text,
  -- Optional explicit geometry: road segment line, or a point for radius events.
  geometry geography(Geometry, 4326),
  radius_m integer check (radius_m is null or radius_m > 0),
  -- Last time any source confirmed the current state. Drives freshness.
  last_confirmed_at timestamptz not null default now(),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint city_events_time_order check (expected_ends_at is null or starts_at is null or expected_ends_at >= starts_at),
  constraint city_events_resolved_consistency check ((status in ('RESOLVED', 'CANCELLED')) = (resolved_at is not null))
);
create index city_events_status_idx on city_events (status, category);
create index city_events_window_idx on city_events (starts_at, expected_ends_at);
create index city_events_geometry_gix on city_events using gist (geometry);
create trigger city_events_updated_at before update on city_events for each row execute function set_updated_at();

create table city_event_updates (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,   -- total order of history, even within one transaction
  event_id uuid not null references city_events(id) on delete cascade,
  source_item_id uuid references source_items(id),
  update_type text not null,             -- CREATED, STATUS_CHANGED, ETA_CHANGED, CONFIRMED, RESOLVED, CORRECTED, CONFLICT_NOTED
  previous_status event_status,
  new_status event_status,
  previous_expected_end timestamptz,
  new_expected_end timestamptz,
  message text,
  actor text not null default 'system',  -- 'system', 'connector:<slug>', 'admin:<name>'
  -- clock_timestamp: several updates written in one transaction keep their order.
  created_at timestamptz not null default clock_timestamp()
);
create index city_event_updates_event_idx on city_event_updates (event_id, seq);

create table event_areas (
  event_id uuid not null references city_events(id) on delete cascade,
  area_id uuid not null references areas(id) on delete restrict,
  coverage_type coverage_type not null,
  primary key (event_id, area_id)
);
create index event_areas_area_idx on event_areas (area_id);

create table event_buildings (
  event_id uuid not null references city_events(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete restrict,
  primary key (event_id, building_id)
);
create index event_buildings_building_idx on event_buildings (building_id);

create table event_sources (
  event_id uuid not null references city_events(id) on delete cascade,
  source_item_id uuid not null references source_items(id) on delete restrict,
  relationship evidence_relationship not null,
  created_at timestamptz not null default now(),
  primary key (event_id, source_item_id)
);

-- Extraction staging. One source item can yield several candidates (an
-- article listing three outages → three segments).
create table event_candidates (
  id uuid primary key default gen_random_uuid(),
  source_item_id uuid not null references source_items(id) on delete cascade,
  segment_index integer not null default 0,
  segment_text text not null,
  extracted jsonb not null,              -- validated ExtractionResult (packages/types)
  extractor text not null,               -- 'rules' | 'rules+llm'
  parser_version text not null,
  confidence numeric(3, 2) not null,
  validation_errors jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  status candidate_status not null default 'REVIEW_REQUIRED',
  duplicate_of_event_id uuid references city_events(id) on delete set null,
  duplicate_score numeric(3, 2),
  created_event_id uuid references city_events(id) on delete set null,
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  unique (source_item_id, segment_index)
);
create index event_candidates_status_idx on event_candidates (status, created_at desc);

-- Realtime outbox. Every client-relevant change lands here; the SSE endpoint
-- tails it (works identically on PGlite and Supabase). On Supabase the
-- event tables are additionally published to supabase_realtime.
create table realtime_outbox (
  id bigserial primary key,
  topic text not null,                   -- 'city_events' | 'service_status' | 'weather'
  kind text not null,                    -- 'created' | 'updated' | 'resolved' | 'update_added' | 'refreshed'
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index realtime_outbox_created_idx on realtime_outbox (created_at);

create or replace function city_events_outbox() returns trigger
language plpgsql as $$
begin
  insert into realtime_outbox (topic, kind, entity_id, payload)
  values (
    'city_events',
    case
      when tg_op = 'INSERT' then 'created'
      when new.status in ('RESOLVED', 'CANCELLED') and old.status is distinct from new.status then 'resolved'
      else 'updated'
    end,
    new.id,
    jsonb_build_object('category', new.category, 'status', new.status, 'is_demo', new.is_demo)
  );
  return new;
end $$;
create trigger city_events_outbox_trg after insert or update on city_events
  for each row execute function city_events_outbox();

create or replace function city_event_updates_outbox() returns trigger
language plpgsql as $$
begin
  insert into realtime_outbox (topic, kind, entity_id, payload)
  values ('city_events', 'update_added', new.event_id,
          jsonb_build_object('update_type', new.update_type, 'new_status', new.new_status));
  return new;
end $$;
create trigger city_event_updates_outbox_trg after insert on city_event_updates
  for each row execute function city_event_updates_outbox();

-- Supabase Realtime (no-op where the publication does not exist, e.g. PGlite).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table city_events, city_event_updates, realtime_outbox;
  end if;
end $$;
