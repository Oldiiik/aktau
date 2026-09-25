-- Scheduled ingestion via Supabase Cron (pg_cron + pg_net).
-- Each job calls POST {app_base_url}/api/cron/{job} with the shared secret.
-- Once the app is deployed, store both secrets in Supabase Vault and turn the
-- schedules on (safe to run again; it replaces the jobs):
--   select vault.create_secret('https://<your-app>.vercel.app', 'app_base_url');
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
--   select public.aktau_schedule_jobs();
-- Until then nothing is scheduled, so no job fails every few minutes against
-- an app that does not exist yet. The whole block is skipped where pg_cron is
-- unavailable (local PGlite uses the in-process scheduler instead).

do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'pg_cron/pg_net/vault not available — skipping cron schedules';
    return;
  end if;

  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  create or replace function public.call_aktau_job(job text) returns bigint
  language sql security definer set search_path = public, extensions as $fn$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url') || '/api/cron/' || job,
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $fn$;
  revoke all on function public.call_aktau_job(text) from public, anon, authenticated;

  -- Weather every 10 min · air quality & marine every 30 min · official
  -- notices every 10 min · local media every 15 min · places daily ·
  -- freshness sweep + notifications every 5 min.
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
    return 'scheduled 7 jobs';
  end
  $fn$;
  revoke all on function public.aktau_schedule_jobs() from public, anon, authenticated;

  perform public.aktau_schedule_jobs();
end
$outer$;
