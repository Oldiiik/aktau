-- Geography: microdistricts, buildings, cached places, official observations.

create table areas (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,             -- e.g. 'mkr-14', 'shygys-2', 'aktau'
  name text not null,                    -- canonical display name (en)
  name_kk text,
  name_ru text,
  name_en text,
  area_type area_type not null,
  -- Microdistrict designator as written locally: '14', '3А', '32Б'.
  designator text,
  parent_id uuid references areas(id) on delete set null,
  -- Polygon / MultiPolygon for districts, LineString for road segments.
  geometry geography(Geometry, 4326),
  centroid geography(Point, 4326),
  -- Lower-cased names and aliases ("14 мкр", "14 шағын аудан", "14 mkr")
  -- so that typing "14" never needs an external geocoder.
  search_text text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index areas_geometry_gix on areas using gist (geometry);
create index areas_centroid_gix on areas using gist (centroid);
create index areas_type_idx on areas (area_type);
create index areas_designator_idx on areas (designator) where designator is not null;

create table buildings (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references areas(id) on delete cascade,
  house_number text not null,            -- as written: '46Б', '12/2'
  house_number_norm text not null,       -- upper, no spaces, Latin→Cyrillic look-alikes folded
  display_address text not null,
  point geography(Point, 4326),
  osm_id text,
  external_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (area_id, house_number_norm)
);
create index buildings_point_gix on buildings using gist (point);
create index buildings_area_idx on buildings (area_id);

-- Cached points of interest (OSM Overpass fallback, 2GIS when configured).
create table places (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  external_id text not null,
  name text not null,
  name_kk text,
  name_ru text,
  name_en text,
  category text not null,                -- cafe, restaurant, pharmacy, hospital, school, bus_stop, park, attraction, ...
  point geography(Point, 4326) not null,
  area_id uuid references areas(id) on delete set null,
  address text,
  opening_hours text,                    -- OSM opening_hours syntax, kept verbatim
  phone text,
  website text,
  rating numeric(3, 2),
  review_count integer,
  photos jsonb not null default '[]'::jsonb,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_id)
);
create index places_point_gix on places using gist (point);
create index places_category_idx on places (category);
create index places_name_idx on places (lower(name));
create trigger places_updated_at before update on places for each row execute function set_updated_at();

-- Official station observations (Kazhydromet WIS2). Model forecasts are NOT
-- stored here — they live in api_cache and are always labelled as forecasts.
create table weather_observations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  station_id text not null,              -- WIGOS id, e.g. 0-398-0-38111
  station_name text not null,
  point geography(Point, 4326),
  observed_at timestamptz not null,
  air_temperature_c numeric(5, 2),
  dewpoint_c numeric(5, 2),
  wind_speed_ms numeric(5, 2),
  wind_direction_deg numeric(5, 1),
  wind_gust_ms numeric(5, 2),
  pressure_msl_hpa numeric(6, 1),
  precipitation_mm numeric(6, 2),
  present_weather text,
  raw jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  unique (source_id, station_id, observed_at)
);
create index weather_observations_latest_idx on weather_observations (station_id, observed_at desc);
