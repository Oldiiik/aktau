-- Security: audit log, admin roles, Row Level Security, safe public views.
--
-- Access model
--   anon / authenticated  → SELECT approved city state, areas, public source
--                            metadata; their own profile / places / prefs.
--   admin (admin_users)   → review queue, raw source data, manual changes.
--   server (DATABASE_URL) → the Next.js API connects as the database owner;
--                            it is the only writer and enforces rate limits.
-- Service-role keys and the database URL never reach the browser.

create table admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor', 'owner')),
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  actor text not null,                   -- 'admin:<name>' | 'system' | 'connector:<slug>'
  action text not null,                  -- candidate.approve, event.update, event.resolve, demo.inject, ...
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log (entity_type, entity_id, created_at desc);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users where user_id = auth.uid());
$$;

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table sources enable row level security;
alter table source_items enable row level security;
alter table source_fetch_runs enable row level security;
alter table api_cache enable row level security;
alter table rate_limits enable row level security;
alter table areas enable row level security;
alter table buildings enable row level security;
alter table places enable row level security;
alter table weather_observations enable row level security;
alter table city_events enable row level security;
alter table city_event_updates enable row level security;
alter table event_areas enable row level security;
alter table event_buildings enable row level security;
alter table event_sources enable row level security;
alter table event_candidates enable row level security;
alter table realtime_outbox enable row level security;
alter table user_profiles enable row level security;
alter table device_installations enable row level security;
alter table saved_locations enable row level security;
alter table alert_preferences enable row level security;
alter table notification_deliveries enable row level security;
alter table admin_users enable row level security;
alter table audit_log enable row level security;

-- Public city state (everything in city_events has passed review).
create policy public_read on sources for select using (true);
create policy public_read on areas for select using (true);
create policy public_read on buildings for select using (true);
create policy public_read on places for select using (true);
create policy public_read on weather_observations for select using (true);
create policy public_read on city_events for select using (true);
create policy public_read on city_event_updates for select using (true);
create policy public_read on event_areas for select using (true);
create policy public_read on event_buildings for select using (true);
create policy public_read on event_sources for select using (true);
create policy public_read on realtime_outbox for select using (true);

-- Admin-only raw material and review.
create policy admin_all on source_items for all using (is_admin()) with check (is_admin());
create policy admin_all on source_fetch_runs for all using (is_admin()) with check (is_admin());
create policy admin_all on event_candidates for all using (is_admin()) with check (is_admin());
create policy admin_read on audit_log for select using (is_admin());
create policy admin_read on admin_users for select using (is_admin());
create policy admin_write on city_events for all using (is_admin()) with check (is_admin());
create policy admin_write on city_event_updates for all using (is_admin()) with check (is_admin());
create policy admin_write on event_areas for all using (is_admin()) with check (is_admin());
create policy admin_write on event_buildings for all using (is_admin()) with check (is_admin());
create policy admin_write on event_sources for all using (is_admin()) with check (is_admin());

-- Private, owner-only.
create policy own_profile on user_profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy own_installations on device_installations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_locations on saved_locations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_preferences on alert_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_deliveries on notification_deliveries for select using (user_id = auth.uid());
-- api_cache, rate_limits: no policies → server only.

-- ── Safe public views ───────────────────────────────────────────────────────
-- Evidence chain without raw HTML or submitter identity.
create view public_event_evidence with (security_invoker = false) as
select es.event_id,
       es.relationship,
       es.created_at as linked_at,
       si.id as source_item_id,
       si.title,
       si.canonical_url,
       si.published_at,
       si.fetched_at,
       si.reported_authority,
       left(si.raw_text, 600) as excerpt,
       s.slug as source_slug,
       s.name as source_name,
       s.organization as source_organization,
       s.source_type,
       s.authority_level
from event_sources es
join source_items si on si.id = es.source_item_id
join sources s on s.id = si.source_id;

-- Source health for the public "Data sources" screen.
create view public_source_status with (security_invoker = false) as
select s.slug, s.name, s.organization, s.source_type, s.authority_level, s.adapter_type,
       s.enabled, s.poll_interval_seconds, s.last_successful_fetch_at, s.last_attempt_at,
       r.status as last_run_status, r.finished_at as last_run_finished_at
from sources s
left join lateral (
  select status, finished_at from source_fetch_runs fr
  where fr.source_id = s.id order by started_at desc limit 1
) r on true;

grant select on public_event_evidence, public_source_status to anon, authenticated;
