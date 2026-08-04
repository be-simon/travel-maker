// F7: "내가 방금 편집한 항목을 다른 멤버의 변경이 곧바로 덮어쓰면" 토스트로
// 알린다 (PRD F7 — last-write-wins의 무통보 데이터 손실 완화). 클라이언트는
// 자신의 편집을 (table, id, 시각)으로 기록해 두고, 수신한 UPDATE 이벤트의
// updated_by가 타인이면서 최근 편집 창(60초) 안이면 알림 대상으로 판정한다.

export const RECENT_EDIT_WINDOW_MS = 60_000

export type EditKey = string

export function makeKey(table: string, id: number): EditKey {
  return `${table}:${id}`
}

export function pruneEdits(edits: Map<EditKey, number>, now: number): void {
  for (const [key, at] of edits) {
    if (now - at > RECENT_EDIT_WINDOW_MS) edits.delete(key)
  }
}

export function shouldNotifyOverwrite(params: {
  edits: Map<EditKey, number>
  table: string
  recordId: number
  editorId: string | null
  myUserId: string
  now: number
}): boolean {
  const { edits, table, recordId, editorId, myUserId, now } = params
  if (!editorId || editorId === myUserId) return false
  const editedAt = edits.get(makeKey(table, recordId))
  return editedAt != null && now - editedAt <= RECENT_EDIT_WINDOW_MS
}
