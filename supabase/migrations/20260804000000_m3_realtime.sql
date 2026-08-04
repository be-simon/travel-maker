-- M3 (F7): 준실시간 동기화 기반.
--
-- 1) postgres_changes를 받으려면 테이블이 supabase_realtime publication에 있어야
--    한다. Realtime은 구독자의 JWT로 RLS를 평가하므로 트립 멤버가 아닌 사용자는
--    INSERT/UPDATE 이벤트를 받지 못한다 (기존 select 정책 재사용). 단, DELETE는
--    예외다 — Postgres logical replication이 넘기는 old record에는 PK만 남아
--    있어 Realtime이 RLS로 걸러낼 수 없으므로, 모든 구독자가 다른 트립의 DELETE
--    이벤트도 받는다. 이때 노출되는 데이터는 {table, id} 뿐이다.
alter publication supabase_realtime add table public.spots;
alter publication supabase_realtime add table public.plan_blocks;
alter publication supabase_realtime add table public.spot_groups;

-- 2) "내가 방금 편집한 항목을 다른 멤버가 곧바로 덮어썼는지"를 클라이언트가
--    판별하려면 이벤트에 편집자가 담겨야 한다. postgres_changes payload에는
--    actor가 없으므로 updated_by 컬럼을 트리거로 기록한다. (자기 자신의 write
--    echo를 무시하는 데에도 이 컬럼을 쓴다.)
alter table public.spots add column updated_by uuid;
alter table public.plan_blocks add column updated_by uuid;

create or replace function private.set_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger spots_set_updated_by
  before insert or update on public.spots
  for each row execute function private.set_updated_by();

create trigger plan_blocks_set_updated_by
  before insert or update on public.plan_blocks
  for each row execute function private.set_updated_by();
