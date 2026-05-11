-- Phase 17 — Public API. Stores hashed API keys + per-key usage tier.
-- Keys are SHA-256 hashed; only the prefix is stored in plaintext for UI
-- ("ig_xxxx…" display) and key rotation lookups.

create table if not exists api_keys (
  id            uuid primary key default gen_random_uuid(),
  key_hash      text not null unique,
  key_prefix    text not null,
  name          text not null,
  owner_email   text,
  tier          text not null default 'researcher'
                check (tier in ('researcher', 'commercial', 'internal')),
  status        text not null default 'active'
                check (status in ('active', 'revoked')),
  rate_per_minute integer not null default 60,
  rate_per_day    integer not null default 10000,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  notes         text
);
create index if not exists idx_api_keys_hash on api_keys (key_hash) where status = 'active';
create index if not exists idx_api_keys_prefix on api_keys (key_prefix);

alter table api_keys enable row level security;

-- Server-role only. Anon and authenticated must NEVER read api_keys directly;
-- the middleware fetches with the service role and never echoes back hashes.
revoke select on api_keys from anon, authenticated;

-- Light request log for analytics + revocation forensics. We DELIBERATELY do
-- not store request bodies, user IP, or anything that could re-identify a
-- person.
create table if not exists api_request_log (
  ts             timestamptz not null default now(),
  api_key_id     uuid references api_keys(id) on delete set null,
  route          text not null,
  status_code    integer not null,
  duration_ms    integer
);
create index if not exists idx_api_request_log_ts on api_request_log (ts desc);
create index if not exists idx_api_request_log_key on api_request_log (api_key_id, ts desc);

alter table api_request_log enable row level security;
revoke select on api_request_log from anon, authenticated;
