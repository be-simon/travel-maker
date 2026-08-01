-- M2: F4 타임라인 플래너용 plan_blocks 테이블.
-- spot_groups/spots는 M1 초기 마이그레이션에서 이미 테이블·RLS·GRANT까지
-- 만들어져 있었지만(데이터 모델을 미리 전부 설계해둔 결과) 앱 레이어에서
-- 아직 쓰이지 않고 있었다. 이 마이그레이션은 plan_blocks만 신규로 추가한다.

create table public.plan_blocks (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips (id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  type text not null check (type in ('spot', 'transport', 'lodging', 'memo')),
  spot_id bigint references public.spots (id) on delete set null,
  title text not null,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_blocks_time_range_chk check (end_time > start_time)
);
create index plan_blocks_trip_id_idx on public.plan_blocks (trip_id);
-- 타임라인은 항상 "이 트립의 이 날짜 블록들"을 조회하므로 복합 인덱스로 커버.
create index plan_blocks_trip_date_idx on public.plan_blocks (trip_id, date);
create index plan_blocks_spot_id_idx on public.plan_blocks (spot_id);

create trigger plan_blocks_set_updated_at
  before update on public.plan_blocks
  for each row execute function private.set_updated_at();

alter table public.plan_blocks enable row level security;

-- 새 테이블은 authenticated 롤에 기본 노출되지 않는다(Supabase 현재 기본값,
-- 20260801000000_initial_schema.sql의 Privileges 섹션 참고) — 이 GRANT가
-- 없으면 RLS 정책과 무관하게 모든 요청이 42501로 거부된다.
grant select, insert, update, delete on public.plan_blocks to authenticated;

-- 후보/배치 없이 트립의 활성 멤버(오너 포함, trips_add_owner_as_member
-- 트리거로 항상 trip_members에 존재) 누구나 편집 가능 — F4가 "동행자 누구나
-- 자유롭게 일정을 조정"하는 캘린더형 편집을 요구하기 때문 (spot_groups_all/
-- spots_all과 동일한 패턴).
create policy plan_blocks_all on public.plan_blocks
  for all to authenticated
  using ((select private.is_trip_member(trip_id)))
  with check ((select private.is_trip_member(trip_id)));
