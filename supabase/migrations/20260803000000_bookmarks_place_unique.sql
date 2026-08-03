-- F3 중복 감지: 같은 계정에 같은 place_id 북마크를 두 번 저장할 수 없게 DB 레벨에서
-- 차단한다 (PRD §4 F3 "중복이면 저장 대신 기존 항목으로 안내"). place_id가 없는
-- 수동 입력은 제약을 받지 않는다.
drop index if exists public.bookmarks_owner_place_idx;
create unique index bookmarks_owner_place_uniq
  on public.bookmarks (owner_id, place_id)
  where place_id is not null;
