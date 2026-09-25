-- Caspian Safety: where swimming is legally permitted or prohibited on the
-- Aktau coast, kept apart from what the sea is doing right now.
--
--   LEGAL  comes only from an authority: the akimat's act on places of mass
--          recreation on water (the official list) and the police/ДЧС list of
--          prohibited stretches. Stored verbatim with the document and revision.
--   STATUS a temporary official status (open / restricted / closed) that only
--          an authorised editor can set, with the authority it came from.
--   NOW    live wind and waves are shown as facts next to it and are never
--          turned into "safe" or "allowed" (see city-core/caspian.ts).
--
-- Coast that is in neither list is "not an official swimming area", never "safe".

create table coastline (
  osm_id bigint primary key,
  geometry geography(LineString, 4326) not null
);
create index coastline_gix on coastline using gist (geometry);

create table coast_zones (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  legal_status text not null check (legal_status in ('OFFICIAL', 'PROHIBITED')),
  name text not null,
  name_ru text not null,
  name_kk text,
  -- The authority's own wording for this entry, verbatim.
  official_text text not null,
  source_authority text not null,
  source_title text not null,
  source_url text not null,
  -- Where in the document: 'Приложение, п. 22'.
  source_ref text,
  -- Revision of the document the entry was verified against.
  source_revision date not null,
  verified_at date not null,
  -- Where it is. The act lists names, not coordinates, so every location
  -- records how it was found. 'unmapped' zones have no geometry and are listed,
  -- never drawn and never used to answer "can I swim here?".
  location_confidence text not null check (location_confidence in ('mapped', 'approximate', 'unmapped')),
  location_source text,
  location_note text,
  -- The point the location source gives (a resort, a landmark).
  anchor geography(Point, 4326),
  -- The stretch of shore the zone covers, derived from the coastline.
  geometry geography(Geometry, 4326),
  -- Temporary official status. UNKNOWN until an authority publishes one.
  operational_status text not null default 'UNKNOWN' check (operational_status in ('UNKNOWN', 'OPEN', 'RESTRICTED', 'CLOSED')),
  operational_note text,
  operational_source text,
  operational_updated_at timestamptz,
  operational_updated_by uuid references accounts(id) on delete set null,
  -- Only set when an authority confirms it; null = not published.
  rescue_post boolean,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coast_zones_geometry_gix on coast_zones using gist (geometry);
create trigger coast_zones_updated_at before update on coast_zones for each row execute function set_updated_at();

alter table coastline enable row level security;
alter table coast_zones enable row level security;
create policy public_read on coastline for select using (true);
create policy public_read on coast_zones for select using (true);
create policy admin_all on coast_zones for all using (is_admin()) with check (is_admin());
