-- Civic loop: one city incident, many residents, one traceable result.
--
--   scope          who is affected: a radius, listed buildings, microdistricts,
--                  a road segment, a polygon, the whole city, or a demo session
--   confirmations  residents who independently say "this affects me too".
--                  Not likes: one per person, with where they stood and an
--                  optional note or photo. Reports stay signals.
--   commitment     the responsible team accepts and commits to a start and a
--                  finish; every change is kept in the timeline with its reason
--   completion     proof + what was done; the affected residents verify it
--                  (yes / partially / no), one round per completion
--   recurrence     a problem that comes back links to the previous repair
--   demo sessions  a QR audience is just another scope: after the audience is
--                  chosen, everything runs through the same pipeline
--
-- Nothing here replaces the 109 engine (20260923000800_incidents.sql); it
-- extends the same tables.

-- ── Demo sessions ───────────────────────────────────────────────────────────
create table demo_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,             -- short public code: /live/{code}
  title text not null,
  venue text not null,
  point geography(Point, 4326),
  status text not null default 'active' check (status in ('active', 'ended')),
  created_by text not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Joining needs no account and no GPS: scanning the code is the location.
create table demo_session_members (
  session_id uuid not null references demo_sessions(id) on delete cascade,
  installation_id text not null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (session_id, installation_id)
);
create index demo_session_members_installation_idx on demo_session_members (installation_id);

-- ── Incidents ───────────────────────────────────────────────────────────────
alter table incidents
  add column problem_kind text check (problem_kind in ('outage', 'damage', 'hazard', 'complaint')),
  -- Title written by staff (operator, presenter). Residents' own words stay private.
  add column public_title text,
  add column scope_kind text check (scope_kind in ('radius', 'building', 'buildings', 'area', 'areas', 'road', 'polygon', 'city', 'demo_session')),
  add column scope_radius_m integer check (scope_radius_m is null or scope_radius_m between 10 and 20000),
  add column scope_geometry geography(Geometry, 4326),
  add column scope_source text not null default 'inferred' check (scope_source in ('inferred', 'operator', 'official')),
  add column demo_session_id uuid references demo_sessions(id) on delete cascade,
  add column confirm_count integer not null default 0,
  add column priority_score integer,
  add column priority_reasons jsonb not null default '[]'::jsonb,
  add column priority_source text not null default 'rules' check (priority_source in ('rules', 'operator')),
  add column team text,
  add column assigned_at timestamptz,
  add column commit_start_at timestamptz,
  add column commit_finish_at timestamptz,
  add column deadline_changes integer not null default 0,
  add column evidence_requested_at timestamptz,
  add column completion_note text,
  add column completed_at timestamptz,
  -- A cause is shown only when an organisation, an official notice or an
  -- operator stated it. An AI guess is never a cause.
  add column cause_text text,
  add column cause_source text check (cause_source in ('organization', 'official', 'operator')),
  add column verify_round integer not null default 0,
  add column verify_partial integer not null default 0,
  add column verify_quality numeric(3, 2),
  add column verify_speed numeric(3, 2),
  add column reopen_count integer not null default 0,
  add column reopened_at timestamptz,
  add column closed_by text check (closed_by in ('residents', 'operator')),
  add column previous_incident_id uuid references incidents(id) on delete set null,
  add column merged_into_id uuid references incidents(id) on delete set null;
create index incidents_session_idx on incidents (demo_session_id) where demo_session_id is not null;
create index incidents_previous_idx on incidents (previous_incident_id) where previous_incident_id is not null;
create index incidents_scope_gix on incidents using gist (scope_geometry);

update incidents i set problem_kind = s.intake->>'kind'
  from incident_signals s where s.incident_id = i.id and s.decision = 'created';

-- Buildings and microdistricts in scope. FULL = the whole microdistrict is
-- affected; PARTIAL = the scope only touches it (used to route realtime hints).
create table incident_buildings (
  incident_id uuid not null references incidents(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete cascade,
  source text not null default 'inferred' check (source in ('report', 'confirmation', 'operator', 'inferred')),
  added_at timestamptz not null default now(),
  primary key (incident_id, building_id)
);
create index incident_buildings_building_idx on incident_buildings (building_id);

create table incident_areas (
  incident_id uuid not null references incidents(id) on delete cascade,
  area_id uuid not null references areas(id) on delete cascade,
  coverage coverage_type not null,
  primary key (incident_id, area_id)
);
create index incident_areas_area_idx on incident_areas (area_id);

-- ── Signals: who sent them ──────────────────────────────────────────────────
-- 'staff' = reported from a signed-in operator/admin account (e.g. a presenter);
-- resident counts never include them.
alter table incident_signals
  add column origin text not null default 'resident' check (origin in ('resident', 'staff')),
  add column demo_session_id uuid references demo_sessions(id) on delete cascade;

-- ── Confirmations ───────────────────────────────────────────────────────────
create table incident_confirmations (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  installation_id text not null,
  account_id uuid references accounts(id) on delete set null,
  state text not null check (state in ('confirmed', 'not_affected', 'withdrawn')),
  -- Where the person stood relative to the scope when they answered.
  context text not null default 'unknown' check (context in ('home_in_scope', 'home_nearby', 'here', 'session', 'elsewhere', 'unknown')),
  distance_m integer,
  building_id uuid references buildings(id) on delete set null,
  note text,                              -- private to 109, like signal text
  photo jsonb,                            -- private to 109
  demo_session_id uuid references demo_sessions(id) on delete cascade,
  is_demo boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (incident_id, installation_id)
);
create index incident_confirmations_installation_idx on incident_confirmations (installation_id, created_at desc);
create index incident_confirmations_incident_idx on incident_confirmations (incident_id, state);

-- ── Verification rounds ─────────────────────────────────────────────────────
-- One answer per person per completion round; a reopened incident starts a new round.
alter table incident_verifications
  add column round integer not null default 1,
  add column answer text check (answer in ('yes', 'partial', 'no')),
  add column quality smallint check (quality between 1 and 5),
  add column speed smallint check (speed between 1 and 5),
  add column comment text,
  add column photo jsonb,
  add column updated_at timestamptz not null default now();
update incident_verifications set answer = case when fixed then 'yes' else 'no' end;
alter table incident_verifications alter column answer set not null;
alter table incident_verifications drop constraint incident_verifications_pkey;
alter table incident_verifications add primary key (incident_id, installation_id, round);
update incidents i set verify_round = 1 where exists (select 1 from incident_verifications v where v.incident_id = i.id);

-- ── Timeline: where each step came from, and who may see it ─────────────────
alter table incident_timeline
  add column source text,
  add column visibility text not null default 'public' check (visibility in ('public', 'staff'));
update incident_timeline set source = case
  when actor = 'resident' then 'resident'
  when actor = 'copilot' then 'ai'
  when actor like 'executor%' then 'organization'
  when actor like 'operator%' or actor like 'admin%' then 'operator'
  else 'automated' end;
update incident_timeline set visibility = 'staff' where kind in ('routing', 'check', 'qc');
alter table incident_timeline alter column source set default 'automated', alter column source set not null,
  add constraint incident_timeline_source_check check (source in ('resident', '109', 'official', 'operator', 'organization', 'automated', 'ai'));
-- Internal steps (copilot routing, spam check, quality check) are for 109 only.
drop policy public_read on incident_timeline;
create policy public_read on incident_timeline for select using (visibility = 'public');

-- ── Resident messages: typed, so a verification request can carry buttons ──
alter table incident_messages
  add column kind text not null default 'update',
  add column data jsonb not null default '{}'::jsonb;

-- ── Realtime payload ────────────────────────────────────────────────────────
-- Enough for a client to decide whether to refetch (session, touched areas)
-- and to show counts at once; the client still refetches canonical state.
create or replace function incidents_outbox() returns trigger
language plpgsql set search_path = public as $$
begin
  insert into realtime_outbox (topic, kind, entity_id, payload)
  values ('incidents', case when tg_op = 'INSERT' then 'created' else 'updated' end, new.id,
          jsonb_build_object(
            'status', new.status, 'service', new.service, 'signals', new.signal_count, 'confirms', new.confirm_count,
            'priority', new.priority, 'is_demo', new.is_demo, 'session', new.demo_session_id, 'scope', new.scope_kind,
            'verify', jsonb_build_array(new.verify_yes, new.verify_partial, new.verify_no), 'round', new.verify_round,
            'areas', coalesce((select jsonb_agg(ia.area_id) from incident_areas ia where ia.incident_id = new.id), '[]'::jsonb)));
  return new;
end $$;

create or replace function demo_session_members_outbox() returns trigger
language plpgsql set search_path = public as $$
begin
  insert into realtime_outbox (topic, kind, entity_id, payload)
  values ('incidents', 'session_member', new.session_id, jsonb_build_object('session', new.session_id));
  return new;
end $$;
create trigger demo_session_members_outbox_trg after insert on demo_session_members
  for each row execute function demo_session_members_outbox();

-- ── Security ────────────────────────────────────────────────────────────────
-- Scope is public city state (like event_buildings); confirmations, members
-- and sessions are read only by the server.
alter table demo_sessions enable row level security;
alter table demo_session_members enable row level security;
alter table incident_buildings enable row level security;
alter table incident_areas enable row level security;
alter table incident_confirmations enable row level security;
create policy public_read on incident_buildings for select using (true);
create policy public_read on incident_areas for select using (true);
create policy admin_all on incident_buildings for all using (is_admin()) with check (is_admin());
create policy admin_all on incident_areas for all using (is_admin()) with check (is_admin());
create policy admin_all on incident_confirmations for all using (is_admin()) with check (is_admin());
create policy admin_all on demo_sessions for all using (is_admin()) with check (is_admin());
create policy admin_all on demo_session_members for all using (is_admin()) with check (is_admin());
