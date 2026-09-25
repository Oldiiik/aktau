-- Aktau · foundations
-- All timestamps are timestamptz stored in UTC. Presentation uses Asia/Aqtau.

create extension if not exists postgis;

create type source_type as enum ('OFFICIAL', 'GOVERNMENT', 'PROVIDER', 'MEDIA', 'COMMUNITY', 'API', 'MANUAL');

create type processing_status as enum ('NEW', 'EXTRACTED', 'FAILED', 'IGNORED', 'REVIEW_REQUIRED');

create type event_category as enum (
  'WATER', 'HOT_WATER', 'ELECTRICITY', 'HEATING', 'GAS', 'ROAD', 'TRANSPORT',
  'WEATHER', 'AIR_QUALITY', 'CASPIAN', 'EMERGENCY', 'EVENT', 'OTHER'
);

create type event_status as enum ('SCHEDULED', 'ACTIVE', 'DEGRADED', 'DELAYED', 'RESOLVED', 'CANCELLED', 'UNCONFIRMED');

create type event_severity as enum ('INFO', 'MINOR', 'MODERATE', 'MAJOR', 'CRITICAL');

create type verification_status as enum ('OFFICIAL', 'VERIFIED', 'CORROBORATED', 'COMMUNITY', 'UNCONFIRMED');

create type area_type as enum ('CITY', 'MICRODISTRICT', 'NEIGHBORHOOD', 'COASTAL_ZONE', 'ROAD_SEGMENT');

create type coverage_type as enum ('FULL', 'PARTIAL', 'BUILDINGS_ONLY');

create type evidence_relationship as enum ('PRIMARY', 'CONFIRMING', 'UPDATE', 'CONTRADICTING');

create type candidate_status as enum ('REVIEW_REQUIRED', 'APPROVED', 'MERGED', 'REJECTED', 'AUTO_APPROVED');

create type user_mode as enum ('RESIDENT', 'VISITOR', 'EXPLORER');

create type app_language as enum ('kk', 'ru', 'en');

create type saved_location_type as enum ('HOME', 'WORK', 'SCHOOL', 'HOTEL', 'CUSTOM');

create type notification_type as enum ('PLANNED', 'STARTED', 'UPDATED', 'RESOLVED', 'CANCELLED');

create type delivery_status as enum ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

create type fetch_run_status as enum ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');

-- Whether a weather-type statement comes from an authority or is our own
-- transparent threshold-based advisory ("Aktau app advisory").
create type advisory_origin as enum ('OFFICIAL', 'APP_ADVISORY');

-- Shared trigger: keep updated_at honest.
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
