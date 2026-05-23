-- Phase 28 — api_keys audit trail.
--
-- The existing api_keys table records create + last_used timestamps but
-- nothing about subsequent state changes — tier swaps, rate-limit edits,
-- revoke, restore, name renames. When an incident happens ("was this key
-- revoked before or after the suspicious activity?") there's no record to
-- answer it. We add an insert-only sibling table fed by a trigger.
--
-- The trigger logs the *post-change* row + the operator/role that made the
-- change. We don't try to log the diff inline — operators inspecting an
-- incident can compare adjacent audit rows.
--
-- Service-role only, like api_keys itself.

create table if not exists api_keys_audit (
  audit_id      bigserial primary key,
  changed_at    timestamptz not null default now(),
  changed_by    text not null default current_user,
  op            text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  -- Snapshot of the row after the change (NULL on DELETE — see trigger).
  api_key_id    uuid,
  key_prefix    text,
  name          text,
  owner_email_hash text,
  tier          text,
  status        text,
  rate_per_minute integer,
  rate_per_day    integer,
  notes         text,
  -- Useful when correlating against logs.
  txid          bigint not null default txid_current()
);

create index if not exists idx_api_keys_audit_api_key_id
  on api_keys_audit (api_key_id, changed_at desc);
create index if not exists idx_api_keys_audit_changed_at
  on api_keys_audit (changed_at desc);

alter table api_keys_audit enable row level security;
revoke all on api_keys_audit from anon, authenticated;
revoke all on sequence api_keys_audit_audit_id_seq from anon, authenticated;
grant select on api_keys_audit to service_role;

create or replace function public.log_api_keys_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  row api_keys%rowtype;
begin
  if tg_op = 'DELETE' then
    row := OLD;
  else
    row := NEW;
  end if;
  insert into api_keys_audit (
    op, api_key_id, key_prefix, name, owner_email_hash,
    tier, status, rate_per_minute, rate_per_day, notes
  ) values (
    tg_op, row.id, row.key_prefix, row.name, row.owner_email_hash,
    row.tier, row.status, row.rate_per_minute, row.rate_per_day, row.notes
  );
  if tg_op = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

revoke all on function public.log_api_keys_change() from public, anon, authenticated;
grant execute on function public.log_api_keys_change() to service_role;

drop trigger if exists trg_api_keys_audit on api_keys;
create trigger trg_api_keys_audit
  after insert or update or delete on api_keys
  for each row execute function public.log_api_keys_change();

comment on table api_keys_audit is
  'Insert-only audit log of every api_keys mutation. Populated by trg_api_keys_audit. Service-role only.';
