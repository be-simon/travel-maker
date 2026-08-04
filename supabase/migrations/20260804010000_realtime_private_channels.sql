-- 프레즌스/브로드캐스트 채널을 트립 멤버 전용으로 잠근다. postgres_changes 이벤트는
-- 구독자별 RLS로 걸러지지만, presence는 기본(public) 채널에서 아무나 join/track할 수
-- 있다. private 채널 + realtime.messages RLS로 트립 멤버만 조인하게 한다.
create policy "trip_members_can_read_trip_channels"
on realtime.messages
for select
to authenticated
using (
  realtime.topic() like 'trip-%'
  and split_part(realtime.topic(), '-', 2) ~ '^[0-9]+$'
  and (select private.is_trip_member(split_part(realtime.topic(), '-', 2)::bigint))
);

create policy "trip_members_can_write_trip_channels"
on realtime.messages
for insert
to authenticated
with check (
  realtime.topic() like 'trip-%'
  and split_part(realtime.topic(), '-', 2) ~ '^[0-9]+$'
  and (select private.is_trip_member(split_part(realtime.topic(), '-', 2)::bigint))
);
