-- Fixes a privilege-escalation hole found in whole-branch review of M1:
-- trips_update's WITH CHECK is `owner_id = auth.uid() OR is_trip_member(id)`,
-- so an active editor (who passes USING as a member) can UPDATE owner_id to
-- themselves — the WITH CHECK then passes on the first disjunct too — and
-- immediately DELETE the trip (owner-only), evicting the real owner.
--
-- RLS's WITH CHECK cannot reference the pre-update row (no OLD), so this
-- can't be closed from inside the policy alone. Instead, add a BEFORE UPDATE
-- trigger that only allows owner_id to change when the request is being made
-- by the *current* owner (old.owner_id = auth.uid()) — mirrors the existing
-- private.set_updated_at() trigger pattern (no SECURITY DEFINER needed here:
-- the check only reads NEW/OLD and auth.uid(), no other table access, so
-- there's no RLS-recursion concern like the private.is_trip_member() /
-- private.has_pending_invite() helpers have).
--
-- Editors changing title/dates (owner_id left untouched) keep working, since
-- new.owner_id = old.owner_id is always true for that case. Owner-initiated
-- ownership transfer (owner sets owner_id to someone else) is still allowed
-- by this guard, since old.owner_id = auth.uid() holds regardless of what
-- new.owner_id is set to — nothing in the M1 plan needs a transfer feature,
-- but nothing forbids it either, so we don't add an extra restriction beyond
-- "only the current owner may ever change who owns the trip".
create or replace function private.enforce_trip_owner_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id <> old.owner_id and old.owner_id <> (select auth.uid()) then
    raise exception 'only the current trip owner may change owner_id'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trips_owner_id_immutable
  before update on public.trips
  for each row execute function private.enforce_trip_owner_immutable();
