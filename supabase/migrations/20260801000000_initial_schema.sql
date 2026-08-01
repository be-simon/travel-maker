-- Travel Maker — initial schema (M1: F1 인증, F2 워크스페이스, F3 저장한 장소)
-- Data model per docs/PRD.md §7. plan_blocks/lodgings (M2 타임라인) are added in a later migration.

create extension if not exists citext;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ============================================================
-- Tables
-- ============================================================

create table public.trips (
  id bigint generated always as identity primary key,
  title text not null,
  start_date date not null,
  end_date date not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_date_range_chk check (end_date >= start_date)
);
create index trips_owner_id_idx on public.trips (owner_id);

-- user_id is null until an invited (not-yet-registered) user signs in and
-- accept_trip_invite() below matches them by email — PRD §4 F2 "피초대자가
-- 아직 가입 전이어도 초대는 pending 상태로 유지".
create table public.trip_members (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  invited_email citext not null,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  status text not null default 'pending' check (status in ('pending', 'active')),
  created_at timestamptz not null default now(),
  constraint trip_members_trip_email_uniq unique (trip_id, invited_email)
);
create index trip_members_trip_id_idx on public.trip_members (trip_id);
create index trip_members_user_id_idx on public.trip_members (user_id);

-- Account-level library ("저장한 장소") — owner-only, reusable across trips.
create table public.bookmarks (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  category text not null default 'etc' check (category in ('sight', 'restaurant', 'cafe', 'shopping', 'lodging', 'etc')),
  country text,
  city text,
  place_id text,
  lat double precision,
  lng double precision,
  address text,
  memo text,
  source text not null default 'manual' check (source in ('manual', 'gmap_link', 'ocr')),
  created_at timestamptz not null default now()
);
create index bookmarks_owner_id_idx on public.bookmarks (owner_id);
-- F3 dedup check: "저장하기 전 place_id 기준으로 이미 저장된 장소인지 확인"
create index bookmarks_owner_place_idx on public.bookmarks (owner_id, place_id) where place_id is not null;
-- F2 import-by-country/city lookup at trip creation
create index bookmarks_owner_country_city_idx on public.bookmarks (owner_id, country, city);

create table public.spot_groups (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0
);
create index spot_groups_trip_id_idx on public.spot_groups (trip_id);

-- Trip-scoped working copy ("장소"). bookmark_id is provenance-only (nullable,
-- ON DELETE SET NULL): editing a spot must never mutate the source bookmark,
-- and deleting the source bookmark must not delete spots already copied from it.
create table public.spots (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips (id) on delete cascade,
  group_id bigint references public.spot_groups (id) on delete set null,
  bookmark_id bigint references public.bookmarks (id) on delete set null,
  name text not null,
  category text not null default 'etc' check (category in ('sight', 'restaurant', 'cafe', 'shopping', 'lodging', 'etc')),
  place_id text,
  lat double precision,
  lng double precision,
  address text,
  memo text,
  priority boolean not null default false,
  est_cost numeric(10, 2),
  link text,
  status text not null default 'candidate' check (status in ('candidate', 'planned', 'visited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index spots_trip_id_idx on public.spots (trip_id);
create index spots_group_id_idx on public.spots (group_id);
create index spots_bookmark_id_idx on public.spots (bookmark_id);

-- ============================================================
-- updated_at triggers
-- ============================================================

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function private.set_updated_at();

create trigger spots_set_updated_at
  before update on public.spots
  for each row execute function private.set_updated_at();

-- Every trip owner is also its first trip_members row (role=owner, status=active).
-- Without this, spot_groups_all/spots_all below — which only check trip
-- membership, not owner_id — would lock the owner out of their own trip's
-- spots as soon as those tables are used in M2.
create or replace function private.add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.trip_members (trip_id, user_id, invited_email, role, status)
  select new.id, new.owner_id, u.email, 'owner', 'active'
  from auth.users u
  where u.id = new.owner_id;
  return new;
end;
$$;

create trigger trips_add_owner_as_member
  after insert on public.trips
  for each row execute function private.add_owner_as_member();

-- ============================================================
-- RLS helper functions (private schema, not directly callable by clients)
-- ============================================================

create or replace function private.is_trip_member(p_trip_id bigint)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id
      and user_id = (select auth.uid())
      and status = 'active'
  );
$$;

revoke execute on function private.is_trip_member(bigint) from public, anon;
grant execute on function private.is_trip_member(bigint) to authenticated;

-- Invite acceptance goes through this SECURITY DEFINER function rather than a
-- direct UPDATE policy, so an invited user can only ever flip their own
-- pending row to active — never edit anyone else's role or membership.
create or replace function public.accept_trip_invite(p_trip_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.trip_members
  set user_id = (select auth.uid()), status = 'active'
  where trip_id = p_trip_id
    and invited_email = (select auth.jwt() ->> 'email')::public.citext
    and status = 'pending';
end;
$$;

grant execute on function public.accept_trip_invite(bigint) to authenticated;

-- ============================================================
-- Privileges
-- ============================================================
-- New tables are no longer auto-exposed to the Data API roles (Supabase's
-- current default, see api.auto_expose_new_tables in config.toml) — without
-- these grants every request 42501s ("permission denied") before RLS even
-- runs. RLS policies below narrow rows further; these grants only open the
-- table-level door.

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.trips to authenticated;
grant select, insert, update, delete on public.trip_members to authenticated;
grant select, insert, update, delete on public.bookmarks to authenticated;
grant select, insert, update, delete on public.spot_groups to authenticated;
grant select, insert, update, delete on public.spots to authenticated;

-- ============================================================
-- RLS
-- ============================================================

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.bookmarks enable row level security;
alter table public.spot_groups enable row level security;
alter table public.spots enable row level security;

create policy trips_select on public.trips
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (select private.is_trip_member(id))
  );

create policy trips_insert on public.trips
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- Editors may edit trip details; only the owner may delete (F2 권한 정책).
create policy trips_update on public.trips
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    or (select private.is_trip_member(id))
  )
  with check (
    owner_id = (select auth.uid())
    or (select private.is_trip_member(id))
  );

create policy trips_delete on public.trips
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Any active member can see the roster; an invitee can see their own pending
-- row (by email, before user_id is matched) so the UI can show "you were invited".
create policy trip_members_select on public.trip_members
  for select to authenticated
  using (
    (select private.is_trip_member(trip_id))
    or user_id = (select auth.uid())
    or invited_email = (select auth.jwt() ->> 'email')::public.citext
  );

-- Only the trip owner manages membership directly; invitees accept via
-- accept_trip_invite() (SECURITY DEFINER) instead of an UPDATE policy.
create policy trip_members_insert on public.trip_members
  for insert to authenticated
  with check (
    exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = (select auth.uid()))
  );

create policy trip_members_update on public.trip_members
  for update to authenticated
  using (
    exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = (select auth.uid()))
  );

create policy trip_members_delete on public.trip_members
  for delete to authenticated
  using (
    exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = (select auth.uid()))
  );

-- Bookmarks are account-scoped and never shared with trip members (PRD §7 동기화 설계).
create policy bookmarks_all on public.bookmarks
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- MVP has only owner/editor roles (no viewer, PRD §4 F2) — any active member can write.
create policy spot_groups_all on public.spot_groups
  for all to authenticated
  using ((select private.is_trip_member(trip_id)))
  with check ((select private.is_trip_member(trip_id)));

create policy spots_all on public.spots
  for all to authenticated
  using ((select private.is_trip_member(trip_id)))
  with check ((select private.is_trip_member(trip_id)));
