-- Fixes a gap found while building M1 Task 6 (home screen "받은 초대"):
-- listPendingInvites() joins trip:trips(*) on trip_members, but the original
-- trips_select policy only allows the owner or an ACTIVE member to see a
-- trip row. A pending (not-yet-accepted) invitee is neither, so PostgREST's
-- embedding silently nulls out the joined trip — the invitee could see that
-- they were invited, but not to which trip, until after accepting blind.
--
-- This is a second, additive SELECT policy (Postgres OR-combines multiple
-- permissive policies for the same command), so it doesn't touch or replace
-- the existing trips_select policy from the initial migration.
--
-- Must go through a SECURITY DEFINER helper (private.has_pending_invite),
-- not a raw subquery in the USING clause: a plain `exists (select 1 from
-- trip_members ...)` here closes a real RLS cycle with trip_members_insert
-- (which itself queries trips in its WITH CHECK) and Postgres refuses it at
-- query-rewrite time with "42P17 infinite recursion detected in policy for
-- relation trip_members" — confirmed by hitting this exact error before
-- switching to the definer-function form, same pattern as is_trip_member().
create or replace function private.has_pending_invite(p_trip_id bigint)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id
      and invited_email = (select auth.jwt() ->> 'email')::public.citext
      and status = 'pending'
  );
$$;

revoke execute on function private.has_pending_invite(bigint) from public, anon;
grant execute on function private.has_pending_invite(bigint) to authenticated;

create policy trips_select_pending_invitee on public.trips
  for select to authenticated
  using ((select private.has_pending_invite(id)));
