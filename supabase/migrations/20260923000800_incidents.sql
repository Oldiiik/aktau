-- 109 AI Incident Engine.
--
-- 109 thinks in appeals; the city is made of incidents. Every inbound message
-- (phone, WhatsApp, Instagram, Komek 109, the Aktau app) becomes a SIGNAL.
-- Signals that describe the same physical problem attach to one INCIDENT,
-- which carries routing, SLA, evidence, quality checks and the residents'
-- verification. The regulation already says repeated reports about an
-- incident being handled must not be registered again — this automates it.
--
-- The copilot only proposes (intake, match, route, checks). Operators and
-- executors confirm; every step lands in incident_timeline.

create type incident_status as enum (
  'NEW',                -- candidate incident, awaiting 109 operator confirmation
  'ROUTED',             -- confirmed and sent to the responsible executor
  'ACCEPTED',           -- executor accepted (≤ 120 min by regulation)
  'IN_PROGRESS',        -- crew dispatched / works started
  'EVIDENCE_SUBMITTED', -- executor submitted proof of resolution
  'RESOLVED',           -- closed by 109, awaiting residents' reality check
  'VERIFIED',           -- residents confirmed it is fixed
  'DISPUTED',           -- residents said it is not fixed → back to executor
  'REJECTED'            -- not an incident / out of scope
);

create sequence incident_code_seq start 1040;

create table incidents (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('INC-' || nextval('incident_code_seq')::text),
  -- Finer taxonomy than event_category: streetlight, garbage, elevator, facade …
  service text not null,
  category event_category not null,
  title text not null,
  summary text,
  status incident_status not null default 'NEW',
  priority text not null default 'NORMAL' check (priority in ('CRITICAL', 'HIGH', 'NORMAL', 'LOW')),
  risk_flags text[] not null default '{}',
  area_id uuid references areas(id) on delete set null,
  building_id uuid references buildings(id) on delete set null,
  point geography(Point, 4326),
  location_text text,
  -- Responsibility graph result: [{ level, name, note }], plus the routed org.
  responsible_org text,
  responsible_chain jsonb not null default '[]'::jsonb,
  routing_confidence numeric(3, 2),
  routing_note text,
  needs_human_review boolean not null default false,
  -- An official notice about the same thing (City Incident Graph link).
  city_event_id uuid references city_events(id) on delete set null,
  signal_count integer not null default 0,
  first_signal_at timestamptz not null default now(),
  last_signal_at timestamptz not null default now(),
  accept_due_at timestamptz,
  resolve_due_at timestamptz,
  routed_at timestamptz,
  accepted_at timestamptz,
  dispatched_at timestamptz,
  resolved_at timestamptz,
  verified_at timestamptz,
  returned_count integer not null default 0,
  -- Proof of resolution: [{ kind: before|after, image, lat, lon, captured_at }]
  evidence jsonb not null default '[]'::jsonb,
  evidence_check jsonb,
  response_text text,
  response_check jsonb,
  verify_yes integer not null default 0,
  verify_no integer not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index incidents_status_idx on incidents (status, service);
create index incidents_area_idx on incidents (area_id);
create index incidents_point_gix on incidents using gist (point);
create trigger incidents_updated_at before update on incidents for each row execute function set_updated_at();

create table incident_signals (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents(id) on delete cascade,
  channel text not null check (channel in ('PHONE', 'WHATSAPP', 'INSTAGRAM', 'KOMEK109', 'APP')),
  raw_text text not null,
  lang text,
  intake jsonb not null,                 -- structured copilot intake (packages/city-core/incidents)
  match_score numeric(3, 2),
  match_reasons text[] not null default '{}',
  decision text not null default 'pending' check (decision in ('pending', 'attached', 'created')),
  area_id uuid references areas(id) on delete set null,
  building_id uuid references buildings(id) on delete set null,
  point geography(Point, 4326),
  installation_id text,                  -- anonymous app installation, for updates + reality check
  is_demo boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create index incident_signals_incident_idx on incident_signals (incident_id, created_at);
create index incident_signals_installation_idx on incident_signals (installation_id);

create table incident_timeline (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  incident_id uuid not null references incidents(id) on delete cascade,
  kind text not null,                    -- signal, created, merged, routed, accepted, dispatched, update, evidence, qc, resolved, verified, disputed, returned
  message text not null,
  actor text not null default 'system',  -- 'resident', 'operator', 'executor:<org>', 'copilot'
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index incident_timeline_incident_idx on incident_timeline (incident_id, seq);

create table incident_verifications (
  incident_id uuid not null references incidents(id) on delete cascade,
  installation_id text not null,
  fixed boolean not null,
  created_at timestamptz not null default now(),
  primary key (incident_id, installation_id)
);

-- Residents who reported get one in-app message per incident update.
create table incident_messages (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  installation_id text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index incident_messages_installation_idx on incident_messages (installation_id, created_at desc);

-- Realtime: same outbox, topic 'incidents'.
create or replace function incidents_outbox() returns trigger
language plpgsql as $$
begin
  insert into realtime_outbox (topic, kind, entity_id, payload)
  values ('incidents', case when tg_op = 'INSERT' then 'created' else 'updated' end, new.id,
          jsonb_build_object('status', new.status, 'service', new.service, 'signals', new.signal_count, 'is_demo', new.is_demo));
  return new;
end $$;
create trigger incidents_outbox_trg after insert or update on incidents
  for each row execute function incidents_outbox();

create or replace function incident_signals_outbox() returns trigger
language plpgsql as $$
begin
  insert into realtime_outbox (topic, kind, entity_id, payload)
  values ('incidents', 'signal', new.incident_id, jsonb_build_object('channel', new.channel, 'decision', new.decision));
  return new;
end $$;
create trigger incident_signals_outbox_trg after insert or update on incident_signals
  for each row execute function incident_signals_outbox();

-- Security: incidents and their timeline are public city state; raw signal
-- text (may contain names / phone numbers), verifications and messages are not.
alter table incidents enable row level security;
alter table incident_signals enable row level security;
alter table incident_timeline enable row level security;
alter table incident_verifications enable row level security;
alter table incident_messages enable row level security;
create policy public_read on incidents for select using (true);
create policy public_read on incident_timeline for select using (true);
create policy admin_all on incidents for all using (is_admin()) with check (is_admin());
create policy admin_all on incident_timeline for all using (is_admin()) with check (is_admin());
create policy admin_all on incident_signals for all using (is_admin()) with check (is_admin());
create policy admin_all on incident_verifications for all using (is_admin()) with check (is_admin());
create policy admin_all on incident_messages for all using (is_admin()) with check (is_admin());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table incidents, incident_timeline;
  end if;
end $$;
