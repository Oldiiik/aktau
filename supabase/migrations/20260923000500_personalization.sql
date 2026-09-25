-- Personalisation. Accounts are optional: an anonymous device installation can
-- save places and preferences; signing in simply attaches a user_id.
-- We deliberately store no age, gender or date of birth.

create table user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  mode user_mode not null default 'RESIDENT',
  language app_language not null default 'ru',
  timezone text not null default 'Asia/Aqtau',
  notification_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table device_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  installation_id text not null unique,  -- random id generated on the device
  platform text not null check (platform in ('ios', 'android', 'web')),
  push_token text,                       -- private; never exposed by any public view
  enabled boolean not null default true,
  language app_language not null default 'ru',
  mode user_mode not null default 'RESIDENT',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table saved_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  installation_id uuid references device_installations(id) on delete cascade,
  label text not null,
  type saved_location_type not null,
  area_id uuid references areas(id) on delete set null,
  building_id uuid references buildings(id) on delete set null,
  point geography(Point, 4326),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_locations_owner check (user_id is not null or installation_id is not null),
  constraint saved_locations_has_place check (area_id is not null or building_id is not null or point is not null)
);
create index saved_locations_installation_idx on saved_locations (installation_id);
create index saved_locations_user_idx on saved_locations (user_id);
create index saved_locations_area_idx on saved_locations (area_id);
create index saved_locations_building_idx on saved_locations (building_id);
create index saved_locations_point_gix on saved_locations using gist (point);
create unique index saved_locations_one_primary on saved_locations (coalesce(user_id::text, installation_id::text)) where is_primary;
create trigger saved_locations_updated_at before update on saved_locations for each row execute function set_updated_at();

create table alert_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  installation_id uuid unique references device_installations(id) on delete cascade,
  water boolean not null default true,       -- WATER, HOT_WATER
  electricity boolean not null default true, -- ELECTRICITY
  heating boolean not null default true,     -- HEATING, GAS
  road boolean not null default true,        -- ROAD
  transport boolean not null default false,  -- TRANSPORT
  weather boolean not null default true,     -- WEATHER, AIR_QUALITY, CASPIAN
  emergency boolean not null default true,   -- EMERGENCY: essential, the UI keeps it on
  events boolean not null default false,     -- EVENT
  affects_me_only boolean not null default true,
  minimum_severity event_severity not null default 'MINOR',
  updated_at timestamptz not null default now(),
  constraint alert_preferences_owner check (user_id is not null or installation_id is not null)
);
create trigger alert_preferences_updated_at before update on alert_preferences for each row execute function set_updated_at();

create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references city_events(id) on delete cascade,
  event_update_id uuid references city_event_updates(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  installation_id uuid references device_installations(id) on delete cascade,
  saved_location_id uuid references saved_locations(id) on delete set null,
  notification_type notification_type not null,
  -- One logical notification per (recipient, event, type, state). A second
  -- source confirming the same outage produces the same key → no duplicate.
  dedupe_key text not null unique,
  status delivery_status not null default 'PENDING',
  relevance text not null,               -- DIRECT | AREA | NEARBY
  -- 'in_app' is delivered by being written here (the bell inbox reads it);
  -- 'push' stays PENDING until the FCM/APNs sender confirms.
  channel text not null default 'in_app' check (channel in ('in_app', 'push')),
  title text not null,
  body text not null,
  deep_link text not null,               -- aktau://event/{id}
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_deliveries_event_idx on notification_deliveries (event_id);
create index notification_deliveries_installation_idx on notification_deliveries (installation_id, created_at desc);
