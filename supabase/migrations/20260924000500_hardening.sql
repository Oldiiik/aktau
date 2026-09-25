-- Hardening from the Supabase security advisor (2026-09-24).
--
-- The app talks to Postgres only from the server (DATABASE_URL, table owner,
-- which bypasses RLS). Supabase also exposes the public schema over its REST
-- API with the publishable anon key, so these close what that route could see.

-- Views run with the caller's rights: anon gets only what RLS already allows
-- (raw source items stay admin-only); the server, as owner, still sees all.
alter view public_event_evidence set (security_invoker = true);
alter view public_source_status set (security_invoker = true);

-- The migration ledger is server-only.
alter table _aktau_migrations enable row level security;

-- Trigger functions resolve names only in public.
alter function set_updated_at() set search_path = public;
alter function city_events_outbox() set search_path = public;
alter function city_event_updates_outbox() set search_path = public;
alter function incidents_outbox() set search_path = public;
alter function incident_signals_outbox() set search_path = public;
