import type { PlanBlock, Spot } from '@/types/database'

export interface Anchor {
  lat: number
  lng: number
  label: string
  source: 'current' | 'past' | 'lodging'
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(minutes, 24 * 60))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Today 모드는 기기 로컬 시각 기준으로 "오늘"을 정한다. toISOString()은 UTC라서
// 자정 전후로 날짜가 밀린다 — 로컬 필드로 직접 조립한다.
export function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function findCurrentBlock(todayBlocks: PlanBlock[], nowMinutes: number): PlanBlock | null {
  const inProgress = todayBlocks.filter(
    (b) => timeToMinutes(b.start_time) <= nowMinutes && nowMinutes < timeToMinutes(b.end_time)
  )
  if (inProgress.length === 0) return null
  return inProgress.reduce((latest, b) =>
    timeToMinutes(b.start_time) > timeToMinutes(latest.start_time) ? b : latest
  )
}

export function findNextBlock(todayBlocks: PlanBlock[], nowMinutes: number): PlanBlock | null {
  const upcoming = todayBlocks.filter((b) => timeToMinutes(b.start_time) > nowMinutes)
  if (upcoming.length === 0) return null
  return upcoming.reduce((earliest, b) =>
    timeToMinutes(b.start_time) < timeToMinutes(earliest.start_time) ? b : earliest
  )
}

function blockCoords(
  b: PlanBlock,
  spotById: Map<number, Spot>
): { lat: number; lng: number; label: string } | null {
  if (b.spot_id == null) return null
  const spot = spotById.get(b.spot_id)
  if (!spot || spot.lat == null || spot.lng == null) return null
  return { lat: spot.lat, lng: spot.lng, label: spot.name }
}

// PRD F6 기준점 fallback 체인: 진행 중 블록 → 현재 시각 이전 마지막(이미 끝난) 블록
// → 당일 숙소. lodgings 테이블은 미구현이므로 숙소는 (a) 오늘의 lodging 타입 블록,
// (b) lodging 카테고리 스팟 순으로 대신한다.
export function resolveAnchor(
  todayBlocks: PlanBlock[],
  spots: Spot[],
  nowMinutes: number
): Anchor | null {
  const spotById = new Map(spots.map((s) => [s.id, s]))

  const current = findCurrentBlock(todayBlocks, nowMinutes)
  if (current) {
    const coords = blockCoords(current, spotById)
    if (coords) return { ...coords, source: 'current' }
  }

  const past = todayBlocks
    .filter((b) => timeToMinutes(b.end_time) <= nowMinutes)
    .sort((a, b) => timeToMinutes(b.end_time) - timeToMinutes(a.end_time))
  for (const b of past) {
    const coords = blockCoords(b, spotById)
    if (coords) return { ...coords, source: 'past' }
  }

  const lodgingBlocks = todayBlocks.filter((b) => b.type === 'lodging')
  for (const b of lodgingBlocks) {
    const coords = blockCoords(b, spotById)
    if (coords) return { ...coords, source: 'lodging' }
  }
  const lodgingSpot = spots.find(
    (s) => s.category === 'lodging' && s.lat != null && s.lng != null
  )
  if (lodgingSpot) {
    return { lat: lodgingSpot.lat!, lng: lodgingSpot.lng!, label: lodgingSpot.name, source: 'lodging' }
  }

  return null
}
