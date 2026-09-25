-- Afisha: what's on in Aktau (cinema sessions, concerts, stand-up, theatre,
-- festivals). Facts only (what, when, where, price from) plus the publisher's
-- own short description and poster, always linked to the publisher and its
-- ticket page. Raw fetches are preserved in source_items like any source.

insert into sources (slug, name, organization, source_type, authority_level, base_url, adapter_type, enabled, poll_interval_seconds, language, supports_structured_data, notes) values
('kinoafisha', 'Kinoafisha · Aktau cinemas', 'Kinoafisha (kz.kinoafisha.info)', 'MEDIA', 40, 'https://kz.kinoafisha.info/aktau/cinema/', 'kinoafisha', true, 10800, 'ru', true,
 'Today''s sessions in Aktau cinemas: film, time, format, price from. Linked to the publisher; robots.txt allows it.'),
('sxodim', 'Sxodim · Aktau', 'Sxodim.com', 'MEDIA', 40, 'https://sxodim.com/aktau/afisha', 'sxodim', true, 10800, 'ru', true,
 'Concerts, stand-up, theatre in Aktau: schema.org Event on each page. Linked to the publisher and its tickets.'),
('inaktau', 'inaktau.kz · Afisha', 'inaktau.kz (city portal)', 'MEDIA', 40, 'https://www.inaktau.kz/afisha', 'inaktau', true, 10800, 'ru', true,
 'The city portal''s afisha: schema.org Event. Crawl-delay 5 s is respected.'),
('topbilet', 'Topbilet · Aktau', 'Topbilet.kz', 'MEDIA', 40, 'https://topbilet.kz/ru/city/aktau', 'topbilet', true, 10800, 'ru', true,
 'Ticketed shows in Aktau: date, venue, price from (Open Graph). Linked to the ticket page.')
on conflict (slug) do nothing;

create table afisha_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete restrict,
  external_id text not null,
  url text not null,
  ticket_url text,
  title text not null,
  -- concert | standup | theatre | festival | kids | sport | exhibition | party | other
  category text not null,
  -- The publisher's own short description, never a full text.
  summary text,
  image_url text,
  venue text,
  address text,
  starts_at timestamptz not null,
  -- Every start the publisher lists (a festival over three evenings).
  sessions timestamptz[] not null default '{}',
  ends_at timestamptz,
  price_from integer,
  fetched_at timestamptz not null default now(),
  unique (source_id, external_id)
);
create index afisha_events_starts_idx on afisha_events (starts_at);

create table cinema_sessions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete restrict,
  cinema_id text not null,
  cinema_name text not null,
  cinema_address text,
  film_id text not null,
  film_title text not null,
  film_url text,
  genres text,
  details text,
  poster_url text,
  starts_at timestamptz not null,
  -- "2D, KK": picture and language as the cinema lists them
  format text,
  language text,
  price_from integer,
  fetched_at timestamptz not null default now(),
  unique (source_id, cinema_id, film_id, starts_at, format)
);
create index cinema_sessions_starts_idx on cinema_sessions (starts_at);

alter table afisha_events enable row level security;
alter table cinema_sessions enable row level security;
create policy public_read on afisha_events for select using (true);
create policy public_read on cinema_sessions for select using (true);
create policy admin_all on afisha_events for all using (is_admin()) with check (is_admin());
create policy admin_all on cinema_sessions for all using (is_admin()) with check (is_admin());

-- Supabase Cron: the afisha job every 3 hours, next to the others (see 20260923000700_cron.sql).
do $outer$
begin
  if not exists (select 1 from pg_proc where proname = 'aktau_schedule_jobs') then
    raise notice 'aktau_schedule_jobs() not present (no pg_cron here) — skipping';
    return;
  end if;
  create or replace function public.aktau_schedule_jobs() returns text
  language plpgsql security definer set search_path = public, extensions as $fn$
  begin
    if not exists (select 1 from vault.decrypted_secrets where name = 'app_base_url')
       or not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
      return 'not scheduled: store app_base_url and cron_secret in Vault first';
    end if;
    perform cron.schedule('aktau-weather',       '*/10 * * * *', $$select public.call_aktau_job('weather')$$);
    perform cron.schedule('aktau-observations',  '7,37 * * * *', $$select public.call_aktau_job('observations')$$);
    perform cron.schedule('aktau-air-marine',    '*/30 * * * *', $$select public.call_aktau_job('air-marine')$$);
    perform cron.schedule('aktau-notices',       '*/10 * * * *', $$select public.call_aktau_job('notices')$$);
    perform cron.schedule('aktau-media',         '*/15 * * * *', $$select public.call_aktau_job('media')$$);
    perform cron.schedule('aktau-places',        '17 3 * * *',   $$select public.call_aktau_job('places')$$);
    perform cron.schedule('aktau-lifecycle',     '*/5 * * * *',  $$select public.call_aktau_job('lifecycle')$$);
    perform cron.schedule('aktau-afisha',        '23 */3 * * *', $$select public.call_aktau_job('afisha')$$);
    return 'scheduled 8 jobs';
  end
  $fn$;
  revoke all on function public.aktau_schedule_jobs() from public, anon, authenticated;
  perform public.aktau_schedule_jobs();
end
$outer$;
