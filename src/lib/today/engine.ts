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

export const MIN_STAY_MINUTES = 30
export const WALK_SPEED_KM_PER_HOUR = 4.5
export const DEFAULT_BLOCK_MINUTES = 60

export interface Recommendation {
  spot: Spot
  distanceKm: number
  walkMin: number
  fitsBeforeNext: boolean
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// 직선거리 기반 도보 시간 추정 — 실제 경로와 다를 수 있음(PRD F4/F5와 동일한 경량 힌트).
export function walkMinutes(km: number): number {
  return Math.ceil((km / WALK_SPEED_KM_PER_HOUR) * 60)
}

// 지금 시각(15분 단위 올림)부터 오늘 블록들 사이에서 durationMinutes짜리 빈 슬롯을
// 찾는다. 다음 블록까지 남은 틈이 MIN_STAY_MINUTES 이상이면 슬롯을 그 틈 크기로
// 줄여서라도 끼워 넣고, 그보다 좁으면 그 블록 뒤로 넘어간다. 24:00을 넘기면 잘라
// 내되 MIN_STAY_MINUTES 미만이 되면 null(오늘은 자리가 없음).
export function findInsertSlot(
  todayBlocks: PlanBlock[],
  nowMinutes: number,
  durationMinutes: number = DEFAULT_BLOCK_MINUTES
): { startTime: string; endTime: string } | null {
  const sorted = [...todayBlocks].sort((a, b) => a.start_time.localeCompare(b.start_time))
  let start = Math.ceil(nowMinutes / 15) * 15
  let duration = durationMinutes

  for (const b of sorted) {
    const bStart = timeToMinutes(b.start_time)
    const bEnd = timeToMinutes(b.end_time)
    if (bEnd <= start) continue
    if (bStart >= start + duration) break
    if (bStart - start >= MIN_STAY_MINUTES) {
      duration = bStart - start
      break
    }
    start = Math.max(start, bEnd)
  }

  if (start + duration > 24 * 60) {
    if (24 * 60 - start < MIN_STAY_MINUTES) return null
    duration = 24 * 60 - start
  }

  return { startTime: minutesToTime(start), endTime: minutesToTime(start + duration) }
}

export function shiftTimes(
  start: string,
  end: string,
  deltaMinutes: number
): { start: string; end: string } | null {
  const s = timeToMinutes(start) + deltaMinutes
  const e = timeToMinutes(end) + deltaMinutes
  if (s < 0 || e > 24 * 60) return null
  return { start: minutesToTime(s), end: minutesToTime(e) }
}

// 자체 경로 계산 없이 기기의 지도 앱에 위임한다 (PRD F6).
export function directionsUrl(
  spot: Pick<Spot, 'name' | 'lat' | 'lng' | 'place_id'>
): string | null {
  if (spot.lat != null && spot.lng != null) {
    const placeParam = spot.place_id ? `&destination_place_id=${spot.place_id}` : ''
    return `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}${placeParam}`
  }
  if (spot.place_id) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(spot.name)}&destination_place_id=${spot.place_id}`
  }
  return null
}

export function recommendSpots(
  spots: Spot[],
  todayBlocks: PlanBlock[],
  anchor: Anchor,
  nowMinutes: number
): Recommendation[] {
  const scheduledSpotIds = new Set(
    todayBlocks.map((b) => b.spot_id).filter((id): id is number => id != null)
  )
  const next = findNextBlock(todayBlocks, nowMinutes)
  const remaining = next ? timeToMinutes(next.start_time) - nowMinutes : null

  return spots
    .filter(
      (s) =>
        s.status !== 'visited' &&
        s.lat != null &&
        s.lng != null &&
        !scheduledSpotIds.has(s.id)
    )
    .map((s) => {
      const distanceKm = haversineKm(anchor, { lat: s.lat!, lng: s.lng! })
      const walkMin = walkMinutes(distanceKm)
      const fitsBeforeNext = remaining == null ? true : walkMin + MIN_STAY_MINUTES <= remaining
      return { spot: s, distanceKm, walkMin, fitsBeforeNext }
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
}
