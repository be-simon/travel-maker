// F4 캘린더형 편집의 좌표 수학. 전부 순수 함수 — 드래그 UI(timeline-view)가
// 픽셀 좌표를 넘기면 15분 스냅된 시간 범위를 돌려받는다.

export const SNAP_MINUTES = 15
export const MIN_BLOCK_MINUTES = 15
export const DAY_MINUTES = 24 * 60

export function snapMinutes(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES
}

export function clampMinutes(m: number, min = 0, max = DAY_MINUTES): number {
  return Math.max(min, Math.min(m, max))
}

export function pxToMinutes(px: number, pxPerMinute: number): number {
  return clampMinutes(snapMinutes(px / pxPerMinute))
}

export function dragCreateRange(
  anchorPx: number,
  currentPx: number,
  pxPerMinute: number
): { startMin: number; endMin: number } {
  const a = pxToMinutes(Math.min(anchorPx, currentPx), pxPerMinute)
  const b = pxToMinutes(Math.max(anchorPx, currentPx), pxPerMinute)
  const startMin = clampMinutes(a, 0, DAY_MINUTES - MIN_BLOCK_MINUTES)
  const endMin = clampMinutes(Math.max(b, startMin + MIN_BLOCK_MINUTES))
  return { startMin, endMin }
}

export function moveRange(
  startMin: number,
  endMin: number,
  deltaPx: number,
  pxPerMinute: number
): { startMin: number; endMin: number } {
  const duration = endMin - startMin
  const next = clampMinutes(snapMinutes(startMin + deltaPx / pxPerMinute), 0, DAY_MINUTES - duration)
  return { startMin: next, endMin: next + duration }
}

export function resizeRange(
  startMin: number,
  endMin: number,
  edge: 'top' | 'bottom',
  deltaPx: number,
  pxPerMinute: number
): { startMin: number; endMin: number } {
  if (edge === 'top') {
    const next = clampMinutes(
      snapMinutes(startMin + deltaPx / pxPerMinute),
      0,
      endMin - MIN_BLOCK_MINUTES
    )
    return { startMin: next, endMin }
  }
  const next = clampMinutes(
    snapMinutes(endMin + deltaPx / pxPerMinute),
    startMin + MIN_BLOCK_MINUTES,
    DAY_MINUTES
  )
  return { startMin, endMin: next }
}
