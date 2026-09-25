-- Accounts and roles.
--
-- Aktau works without an account: personalisation lives on an anonymous
-- installation id. An account is optional for residents (it carries their
-- places across devices) and required for staff:
--   resident  the public app
--   operator  + 109 Copilot (the unified contact centre's workspace)
--   admin     + the editor console (sources, review queue, events, audit, accounts)
--
-- Only the server (database owner) reads or writes this table. Passwords are
-- stored as scrypt hashes; sessions are signed cookies whose version is checked
-- here on every privileged request (bumped on role change, disable, sign-out-all).

create type account_role as enum ('resident', 'operator', 'admin');

create table accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text,
  password_hash text not null,
  role account_role not null default 'resident',
  -- The anonymous installation this account adopted: signing in on another
  -- device brings saved places, alert preferences and the inbox with it.
  installation_id text,
  session_version integer not null default 1,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);
create unique index accounts_email_uq on accounts (lower(email));
create index accounts_role_idx on accounts (role) where role <> 'resident';
create trigger accounts_updated_at before update on accounts for each row execute function set_updated_at();

alter table accounts enable row level security;
-- No policies on purpose: not readable through the public API at all.
