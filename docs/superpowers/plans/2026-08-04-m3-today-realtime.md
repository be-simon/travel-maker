# M3: Today 모드(F6) + 준실시간 동기화(F7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRD 로드맵 M3 — 여행 중 모드(Today 뷰)와 Supabase Realtime 기반 준실시간 동기화를 구현한다.

**Architecture:** F6은 순수 함수 엔진(`src/lib/today/engine.ts`, vitest node 테스트 대상)과 이를 소비하는 `/trips/[tripId]/today` 라우트(서버 컴포넌트 fetch → 클라이언트 뷰)로 나눈다. F7은 Supabase Realtime `postgres_changes` 구독 → `router.refresh()`로 서버 컴포넌트를 재조회하는 최소 구조를 쓰고(레코드 단위 LWW는 DB 반영 순서가 곧 최종 상태), 프레즌스는 같은 채널의 presence로, "덮어쓰기 토스트"는 `updated_by` 컬럼(트리거로 `auth.uid()` 기록) + 클라이언트의 최근 편집 레지스트리로 감지한다.

**Tech Stack:** Next.js App Router, Supabase (Realtime postgres_changes + presence), @vis.gl/react-google-maps (영업시간 조회), sonner (토스트), vitest.

## Global Constraints

- UI 카피는 한국어. 서버 액션 실패 메시지는 기존 패턴 그대로: `'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'`
- GPS/Geolocation 사용 금지 (PRD §5) — 추천 기준점은 일정 데이터로만 계산한다.
- Places 상세(영업시간)는 영속 저장하지 않는다. 조회 시점에 place_id로 재조회하고 캐시는 세션(모듈 스코프) 한정 (PRD §5).
- 패키지 매니저는 pnpm. 테스트는 `pnpm test`(vitest, node 환경). 순수 함수만 단위 테스트하고, React 컴포넌트/브라우저 API는 테스트하지 않는다(테스트 인프라 없음 — 기존 관례).
- `src/test/rls-*.test.ts`는 로컬 Supabase(`.env.test.local`)가 떠 있어야 통과한다. 로컬 인스턴스가 없으면 해당 파일 제외하고 실행: `pnpm test -- src/lib`
- 날짜는 `'YYYY-MM-DD'`, 시간은 `'HH:MM'`(폼) / `'HH:MM:SS'`(DB) 문자열. DB로 보낼 때 `:00`을 붙인다 (기존 `toDbTime` 관례).
- Today 화면 하단 주요 액션 버튼은 탭 타겟 44px 이상 (`min-h-11`).
- 기존 컴포넌트 재사용: `@/components/ui/*` (Base UI 기반 shadcn), `Button`의 링크 렌더링은 `render={<Link …/>}` 패턴.
- 커밋 메시지는 기존 관례(`feat:`, `fix:`, `test:`) + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
src/lib/today/engine.ts            # F6 순수 로직 전부 (신규)
src/lib/today/engine.test.ts       # 엔진 테스트 (신규)
src/lib/plan-blocks/actions.ts     # shiftBlock 추가, today 경로 revalidate (수정)
src/app/trips/[tripId]/today/page.tsx        # 서버 컴포넌트 (신규)
src/app/trips/[tripId]/today/today-view.tsx  # 클라이언트 뷰 (신규)
src/app/trips/[tripId]/trip-nav.tsx          # Today 탭 활성화 (수정)
src/app/home/page.tsx                        # 여행 중 카드 Today CTA 링크 (수정)
src/lib/places/use-open-now.ts     # 영업 중 배지 훅, 세션 캐시 (신규)
supabase/migrations/20260804000000_m3_realtime.sql  # publication + updated_by (신규)
src/types/database.ts              # updated_by 타입 (수정)
src/lib/realtime/overwrite.ts      # 덮어쓰기 감지 순수 로직 (신규)
src/lib/realtime/overwrite.test.ts # 테스트 (신규)
src/lib/realtime/trip-realtime.tsx # Provider + PresenceAvatars (신규)
src/app/trips/[tripId]/layout.tsx  # Provider로 감싸기 + 프레즌스 (수정)
src/app/layout.tsx                 # sonner Toaster (수정)
src/app/trips/[tripId]/plan/block-dialog.tsx # markEdited 연동 (수정)
```

---

### Task 1: Today 엔진 — 현재/다음 블록과 기준점(anchor)

**Files:**
- Create: `src/lib/today/engine.ts`
- Test: `src/lib/today/engine.test.ts`

**Interfaces:**
- Produces: `timeToMinutes(time: string): number`, `minutesToTime(minutes: number): string`, `localDateString(d: Date): string`, `findCurrentBlock(todayBlocks: PlanBlock[], nowMinutes: number): PlanBlock | null`, `findNextBlock(todayBlocks: PlanBlock[], nowMinutes: number): PlanBlock | null`, `resolveAnchor(todayBlocks: PlanBlock[], spots: Spot[], nowMinutes: number): Anchor | null`, `interface Anchor { lat: number; lng: number; label: string; source: 'current' | 'past' | 'lodging' }`

- [ ] **Step 1: Write the failing test**

`src/lib/today/engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PlanBlock, Spot } from '@/types/database'
import {
  findCurrentBlock,
  findNextBlock,
  localDateString,
  minutesToTime,
  resolveAnchor,
  timeToMinutes,
} from './engine'

let nextId = 1

function block(overrides: Partial<PlanBlock>): PlanBlock {
  return {
    id: nextId++,
    trip_id: 1,
    date: '2026-08-04',
    start_time: '09:00:00',
    end_time: '10:00:00',
    type: 'spot',
    spot_id: null,
    title: '블록',
    memo: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function spot(overrides: Partial<Spot>): Spot {
  return {
    id: nextId++,
    trip_id: 1,
    group_id: null,
    bookmark_id: null,
    name: '장소',
    category: 'sight',
    place_id: null,
    lat: 45.464,
    lng: 9.19,
    address: null,
    memo: null,
    priority: false,
    est_cost: null,
    link: null,
    status: 'candidate',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('timeToMinutes / minutesToTime', () => {
  it('converts HH:MM and HH:MM:SS', () => {
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('09:30:00')).toBe(570)
    expect(minutesToTime(570)).toBe('09:30')
    expect(minutesToTime(1440)).toBe('24:00')
  })
})

describe('localDateString', () => {
  it('formats local date as YYYY-MM-DD', () => {
    expect(localDateString(new Date(2026, 7, 4, 23, 59))).toBe('2026-08-04')
    expect(localDateString(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01')
  })
})

describe('findCurrentBlock / findNextBlock', () => {
  const blocks = [
    block({ start_time: '09:00:00', end_time: '10:00:00', title: 'a' }),
    block({ start_time: '09:30:00', end_time: '11:00:00', title: 'b' }),
    block({ start_time: '13:00:00', end_time: '14:00:00', title: 'c' }),
  ]

  it('returns the block containing now, preferring the latest start', () => {
    expect(findCurrentBlock(blocks, timeToMinutes('09:45'))?.title).toBe('b')
  })

  it('start is inclusive, end is exclusive', () => {
    expect(findCurrentBlock(blocks, timeToMinutes('13:00'))?.title).toBe('c')
    expect(findCurrentBlock(blocks, timeToMinutes('14:00'))).toBeNull()
  })

  it('returns null when nothing is in progress', () => {
    expect(findCurrentBlock(blocks, timeToMinutes('12:00'))).toBeNull()
  })

  it('finds the earliest block starting after now', () => {
    expect(findNextBlock(blocks, timeToMinutes('09:10'))?.title).toBe('b')
    expect(findNextBlock(blocks, timeToMinutes('12:00'))?.title).toBe('c')
    expect(findNextBlock(blocks, timeToMinutes('13:00'))).toBeNull()
  })
})

describe('resolveAnchor', () => {
  it('uses the current block spot location first', () => {
    const s = spot({ name: '두오모', lat: 45.464, lng: 9.19 })
    const blocks = [block({ start_time: '09:00:00', end_time: '10:00:00', spot_id: s.id })]
    const anchor = resolveAnchor(blocks, [s], timeToMinutes('09:30'))
    expect(anchor).toEqual({ lat: 45.464, lng: 9.19, label: '두오모', source: 'current' })
  })

  it('falls back to the last finished block with coordinates', () => {
    const s1 = spot({ name: '아침', lat: 1, lng: 1 })
    const s2 = spot({ name: '점심', lat: 2, lng: 2 })
    const blocks = [
      block({ start_time: '08:00:00', end_time: '09:00:00', spot_id: s1.id }),
      block({ start_time: '11:00:00', end_time: '12:00:00', spot_id: s2.id }),
    ]
    const anchor = resolveAnchor(blocks, [s1, s2], timeToMinutes('13:00'))
    expect(anchor).toEqual({ lat: 2, lng: 2, label: '점심', source: 'past' })
  })

  it('skips past blocks without coordinates', () => {
    const s1 = spot({ name: '좌표 있음', lat: 1, lng: 1 })
    const s2 = spot({ name: '좌표 없음', lat: null, lng: null })
    const blocks = [
      block({ start_time: '08:00:00', end_time: '09:00:00', spot_id: s1.id }),
      block({ start_time: '11:00:00', end_time: '12:00:00', spot_id: s2.id }),
    ]
    expect(resolveAnchor(blocks, [s1, s2], timeToMinutes('13:00'))?.label).toBe('좌표 있음')
  })

  it('falls back to a lodging block on the same day, then any lodging spot', () => {
    const lodgingSpot = spot({ name: '호텔', category: 'lodging', lat: 3, lng: 3 })
    const lodgingBlock = block({
      start_time: '20:00:00',
      end_time: '22:00:00',
      type: 'lodging',
      spot_id: lodgingSpot.id,
    })
    expect(resolveAnchor([lodgingBlock], [lodgingSpot], timeToMinutes('10:00'))).toEqual({
      lat: 3,
      lng: 3,
      label: '호텔',
      source: 'lodging',
    })
    // 블록이 하나도 없어도 lodging 카테고리 스팟이 있으면 그걸 쓴다
    expect(resolveAnchor([], [lodgingSpot], timeToMinutes('10:00'))).toEqual({
      lat: 3,
      lng: 3,
      label: '호텔',
      source: 'lodging',
    })
  })

  it('returns null when nothing has coordinates', () => {
    expect(resolveAnchor([], [spot({ lat: null, lng: null })], 600)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/today/engine.test.ts`
Expected: FAIL — `Cannot find module './engine'` (또는 export 누락)

- [ ] **Step 3: Write minimal implementation**

`src/lib/today/engine.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/today/engine.test.ts`
Expected: PASS (전체)

- [ ] **Step 5: Commit**

```bash
git add src/lib/today/engine.ts src/lib/today/engine.test.ts
git commit -m "feat: add Today engine — current/next block and anchor resolution"
```

---

### Task 2: Today 엔진 — 거리 계산과 추천 정렬

**Files:**
- Modify: `src/lib/today/engine.ts`
- Test: `src/lib/today/engine.test.ts` (추가)

**Interfaces:**
- Consumes: Task 1의 `findNextBlock`, `timeToMinutes`, `Anchor`
- Produces: `haversineKm(a: {lat:number; lng:number}, b: {lat:number; lng:number}): number`, `walkMinutes(km: number): number`, `recommendSpots(spots: Spot[], todayBlocks: PlanBlock[], anchor: Anchor, nowMinutes: number): Recommendation[]`, `interface Recommendation { spot: Spot; distanceKm: number; walkMin: number; fitsBeforeNext: boolean }`, 상수 `MIN_STAY_MINUTES = 30`

- [ ] **Step 1: Write the failing test** — `engine.test.ts`에 추가:

```ts
import { haversineKm, recommendSpots, walkMinutes } from './engine'

describe('haversineKm / walkMinutes', () => {
  it('computes straight-line distance (Milan Duomo → Sforza Castle ≈ 1.1km)', () => {
    const km = haversineKm({ lat: 45.4642, lng: 9.1919 }, { lat: 45.4705, lng: 9.1794 })
    expect(km).toBeGreaterThan(0.9)
    expect(km).toBeLessThan(1.4)
  })

  it('is zero for identical points', () => {
    expect(haversineKm({ lat: 45, lng: 9 }, { lat: 45, lng: 9 })).toBe(0)
  })

  it('estimates walking minutes at 4.5km/h, rounded up', () => {
    expect(walkMinutes(0)).toBe(0)
    expect(walkMinutes(1.5)).toBe(20)
    expect(walkMinutes(0.1)).toBe(2)
  })
})

describe('recommendSpots', () => {
  const anchor = { lat: 45.0, lng: 9.0, label: '기준', source: 'current' as const }

  it('filters visited, coordinate-less, and already-scheduled-today spots', () => {
    const visited = spot({ name: '방문함', status: 'visited', lat: 45.0, lng: 9.0 })
    const noCoords = spot({ name: '좌표 없음', lat: null, lng: null })
    const scheduled = spot({ name: '오늘 배치됨', lat: 45.0, lng: 9.0 })
    const ok = spot({ name: '추천 대상', lat: 45.001, lng: 9.0 })
    const blocks = [block({ start_time: '09:00:00', end_time: '10:00:00', spot_id: scheduled.id })]
    const recs = recommendSpots([visited, noCoords, scheduled, ok], blocks, anchor, 600)
    expect(recs.map((r) => r.spot.name)).toEqual(['추천 대상'])
  })

  it('sorts by distance ascending', () => {
    const far = spot({ name: '멀리', lat: 45.1, lng: 9.0 })
    const near = spot({ name: '가까이', lat: 45.001, lng: 9.0 })
    const recs = recommendSpots([far, near], [], anchor, 600)
    expect(recs.map((r) => r.spot.name)).toEqual(['가까이', '멀리'])
    expect(recs[0].distanceKm).toBeLessThan(recs[1].distanceKm)
  })

  it('marks fitsBeforeNext=false when walk + minimum stay exceeds the gap to the next block', () => {
    // 앵커에서 ~11km → 도보 ~148분. 다음 블록까지 60분이면 못 간다.
    const far = spot({ name: '멀리', lat: 45.1, lng: 9.0 })
    const near = spot({ name: '가까이', lat: 45.001, lng: 9.0 })
    const next = block({ start_time: '11:00:00', end_time: '12:00:00' })
    const recs = recommendSpots([far, near], [next], anchor, timeToMinutes('10:00'))
    expect(recs.find((r) => r.spot.name === '가까이')?.fitsBeforeNext).toBe(true)
    expect(recs.find((r) => r.spot.name === '멀리')?.fitsBeforeNext).toBe(false)
  })

  it('treats no next block as always fitting', () => {
    const far = spot({ name: '멀리', lat: 45.1, lng: 9.0 })
    expect(recommendSpots([far], [], anchor, 600)[0].fitsBeforeNext).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/today/engine.test.ts`
Expected: FAIL — `haversineKm` 등 export 없음

- [ ] **Step 3: Write minimal implementation** — `engine.ts`에 추가:

```ts
export const MIN_STAY_MINUTES = 30
export const WALK_SPEED_KM_PER_HOUR = 4.5

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/today/engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/today/engine.ts src/lib/today/engine.test.ts
git commit -m "feat: add distance-based spot recommendations to Today engine"
```

---

### Task 3: Today 엔진 — 빈 슬롯 탐색·시간 이동·길찾기 딥링크

**Files:**
- Modify: `src/lib/today/engine.ts`
- Test: `src/lib/today/engine.test.ts` (추가)

**Interfaces:**
- Consumes: Task 1의 `timeToMinutes`, `minutesToTime`; Task 2의 `MIN_STAY_MINUTES`
- Produces: `findInsertSlot(todayBlocks: PlanBlock[], nowMinutes: number, durationMinutes?: number): { startTime: string; endTime: string } | null`, `shiftTimes(start: string, end: string, deltaMinutes: number): { start: string; end: string } | null`, `directionsUrl(spot: Pick<Spot, 'name' | 'lat' | 'lng' | 'place_id'>): string | null`, 상수 `DEFAULT_BLOCK_MINUTES = 60`

- [ ] **Step 1: Write the failing test** — `engine.test.ts`에 추가:

```ts
import { directionsUrl, findInsertSlot, shiftTimes } from './engine'

describe('findInsertSlot', () => {
  it('starts at now rounded up to 15 minutes on an empty day', () => {
    expect(findInsertSlot([], timeToMinutes('10:07'))).toEqual({
      startTime: '10:15',
      endTime: '11:15',
    })
  })

  it('skips past a block when the gap before it is under the minimum stay', () => {
    const blocks = [block({ start_time: '10:30:00', end_time: '12:00:00' })]
    expect(findInsertSlot(blocks, timeToMinutes('10:07'))).toEqual({
      startTime: '12:00',
      endTime: '13:00',
    })
  })

  it('shrinks into a gap of at least the minimum stay', () => {
    const blocks = [block({ start_time: '10:45:00', end_time: '12:00:00' })]
    expect(findInsertSlot(blocks, timeToMinutes('10:07'))).toEqual({
      startTime: '10:15',
      endTime: '10:45',
    })
  })

  it('clips the final slot at 24:00 and rejects slivers', () => {
    expect(findInsertSlot([], timeToMinutes('23:20'))).toEqual({
      startTime: '23:30',
      endTime: '24:00',
    })
    expect(findInsertSlot([], timeToMinutes('23:50'))).toBeNull()
  })

  it('walks through consecutive blocks', () => {
    const blocks = [
      block({ start_time: '10:00:00', end_time: '11:00:00' }),
      block({ start_time: '11:00:00', end_time: '12:10:00' }),
    ]
    expect(findInsertSlot(blocks, timeToMinutes('10:30'))).toEqual({
      startTime: '12:10',
      endTime: '13:10',
    })
  })
})

describe('shiftTimes', () => {
  it('shifts both times preserving duration', () => {
    expect(shiftTimes('09:00', '10:30', 15)).toEqual({ start: '09:15', end: '10:45' })
    expect(shiftTimes('09:00', '10:30', -15)).toEqual({ start: '08:45', end: '10:15' })
  })

  it('returns null when the shift crosses midnight bounds', () => {
    expect(shiftTimes('00:10', '01:00', -15)).toBeNull()
    expect(shiftTimes('23:00', '23:50', 15)).toBeNull()
  })
})

describe('directionsUrl', () => {
  it('builds a Google Maps directions deeplink from coordinates + place_id', () => {
    expect(
      directionsUrl({ name: '두오모', lat: 45.4642, lng: 9.1919, place_id: 'abc123' })
    ).toBe('https://www.google.com/maps/dir/?api=1&destination=45.4642,9.1919&destination_place_id=abc123')
  })

  it('omits destination_place_id when absent', () => {
    expect(directionsUrl({ name: '두오모', lat: 45.4642, lng: 9.1919, place_id: null })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=45.4642,9.1919'
    )
  })

  it('returns null without coordinates or place_id', () => {
    expect(directionsUrl({ name: 'x', lat: null, lng: null, place_id: null })).toBeNull()
  })

  it('falls back to name + place_id without coordinates', () => {
    expect(directionsUrl({ name: '두오모', lat: null, lng: null, place_id: 'abc' })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=%EB%91%90%EC%98%A4%EB%AA%A8&destination_place_id=abc'
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/today/engine.test.ts`
Expected: FAIL — `findInsertSlot` 등 export 없음

- [ ] **Step 3: Write minimal implementation** — `engine.ts`에 추가:

```ts
export const DEFAULT_BLOCK_MINUTES = 60

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/today/engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/today/engine.ts src/lib/today/engine.test.ts
git commit -m "feat: add insert-slot search, time shift, and directions deeplink to Today engine"
```

---

### Task 4: 서버 액션 — shiftBlock 추가와 Today 경로 revalidate

**Files:**
- Modify: `src/lib/plan-blocks/actions.ts`

**Interfaces:**
- Consumes: Task 3의 `shiftTimes`
- Produces: `shiftBlock(blockId: number, tripId: number, deltaMinutes: number): Promise<ActionResult>` (`ActionResult = { error: string | null }` 기존 그대로)

테스트: 서버 액션은 기존 관례대로 단위 테스트하지 않는다(순수 로직은 Task 3에서 검증 완료). 타입체크와 린트로 확인한다.

- [ ] **Step 1: 기존 액션 3개의 revalidatePath에 today 경로 추가**

`createBlock`, `updateBlock`, `deleteBlock` 각각의 `revalidatePath(...)` 자리에 today 경로를 한 줄씩 추가한다. 예 (`createBlock`):

```ts
  revalidatePath(`/trips/${input.tripId}/plan`)
  revalidatePath(`/trips/${input.tripId}/today`)
  return { error: null }
```

(`updateBlock`/`deleteBlock`은 `tripId` 변수를 사용: `revalidatePath(`/trips/${tripId}/today`)`)

- [ ] **Step 2: shiftBlock 액션 추가** — 파일 끝에 추가, import에 `shiftTimes` 반영:

```ts
import { shiftTimes } from '@/lib/today/engine'
```

```ts
export async function shiftBlock(
  blockId: number,
  tripId: number,
  deltaMinutes: number
): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: block, error: fetchError } = await supabase
    .from('plan_blocks')
    .select('start_time, end_time')
    .eq('id', blockId)
    .maybeSingle()

  if (fetchError || !block) {
    console.error('shiftBlock: failed to load block:', fetchError)
    return { error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  const shifted = shiftTimes(block.start_time.slice(0, 5), block.end_time.slice(0, 5), deltaMinutes)
  if (!shifted) return { error: '자정을 넘겨서는 옮길 수 없습니다.' }

  const { error } = await supabase
    .from('plan_blocks')
    .update({ start_time: `${shifted.start}:00`, end_time: `${shifted.end}:00` })
    .eq('id', blockId)

  if (error) {
    console.error('shiftBlock failed:', error)
    return { error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  revalidatePath(`/trips/${tripId}/plan`)
  revalidatePath(`/trips/${tripId}/today`)
  return { error: null }
}
```

- [ ] **Step 3: 타입체크·린트·기존 테스트 확인**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test -- src/lib`
Expected: 에러 없음, 기존 테스트 PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/plan-blocks/actions.ts
git commit -m "feat: add shiftBlock action and revalidate Today route on block changes"
```

---

### Task 5: Today 페이지 UI + 내비게이션 연결

**Files:**
- Create: `src/app/trips/[tripId]/today/page.tsx`
- Create: `src/app/trips/[tripId]/today/today-view.tsx`
- Modify: `src/app/trips/[tripId]/trip-nav.tsx`
- Modify: `src/app/home/page.tsx`

**Interfaces:**
- Consumes: Task 1–3의 엔진 전부, Task 4의 `shiftBlock`, 기존 `createBlock`(`BlockInput`), 기존 쿼리 `getTrip`/`listSpotsByTrip`/`listBlocksByTrip`
- Produces: 라우트 `/trips/[tripId]/today`; `TodayView({ trip, spots, blocks }: { trip: Trip; spots: Spot[]; blocks: PlanBlock[] })` 클라이언트 컴포넌트. Task 6이 추천 리스트에 배지를 추가하고, Task 9가 `useTripRealtime()`의 `lastSyncedAt`/`markEdited`를 연결한다.

- [ ] **Step 1: 서버 컴포넌트 라우트 작성** — `src/app/trips/[tripId]/today/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { getTrip } from '@/lib/trips/queries'
import { listSpotsByTrip } from '@/lib/spots/queries'
import { listBlocksByTrip } from '@/lib/plan-blocks/queries'
import { MapProvider } from '@/components/map/map-provider'
import { TodayView } from './today-view'

export default async function TodayPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  if (!/^\d+$/.test(tripId)) notFound()
  const numericTripId = Number(tripId)

  const trip = await getTrip(numericTripId)
  if (!trip) notFound()

  const [spots, blocks] = await Promise.all([
    listSpotsByTrip(numericTripId),
    listBlocksByTrip(numericTripId),
  ])

  return (
    <MapProvider>
      <TodayView trip={trip} spots={spots} blocks={blocks} />
    </MapProvider>
  )
}
```

- [ ] **Step 2: 클라이언트 뷰 작성** — `src/app/trips/[tripId]/today/today-view.tsx`:

```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { PlanBlock, Spot, Trip } from '@/types/database'
import { Button } from '@/components/ui/button'
import { createBlock, shiftBlock } from '@/lib/plan-blocks/actions'
import {
  directionsUrl,
  findCurrentBlock,
  findInsertSlot,
  findNextBlock,
  localDateString,
  recommendSpots,
  resolveAnchor,
  timeToMinutes,
  type Recommendation,
} from '@/lib/today/engine'

const TYPE_LABELS: Record<string, string> = {
  spot: '스팟',
  transport: '이동',
  lodging: '숙소',
  memo: '메모',
}

const ANCHOR_SOURCE_LABELS: Record<string, string> = {
  current: '진행 중인 일정',
  past: '직전 일정',
  lodging: '오늘 숙소',
}

const MAX_RECOMMENDATIONS = 8

function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function TodayView({ trip, spots, blocks }: { trip: Trip; spots: Spot[]; blocks: PlanBlock[] }) {
  const router = useRouter()
  const [now, setNow] = useState(() => new Date())
  const [syncedAt, setSyncedAt] = useState(() => new Date())
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const today = localDateString(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const inTripPeriod = trip.start_date <= today && today <= trip.end_date

  const todayBlocks = blocks
    .filter((block) => block.date === today)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))

  const currentBlock = findCurrentBlock(todayBlocks, nowMinutes)
  const nextBlock = findNextBlock(todayBlocks, nowMinutes)
  const anchor = resolveAnchor(todayBlocks, spots, nowMinutes)
  const recommendations = anchor
    ? recommendSpots(spots, todayBlocks, anchor, nowMinutes).slice(0, MAX_RECOMMENDATIONS)
    : []
  const remainingToNext = nextBlock ? timeToMinutes(nextBlock.start_time) - nowMinutes : null
  const spotById = new Map(spots.map((spot) => [spot.id, spot]))

  const refresh = () => {
    router.refresh()
    setSyncedAt(new Date())
    setNow(new Date())
  }

  const addToToday = (rec: Recommendation) => {
    setError(null)
    startTransition(async () => {
      const slot = findInsertSlot(todayBlocks, nowMinutes)
      if (!slot) {
        setError('오늘 남은 빈 시간이 없어 일정을 추가할 수 없습니다.')
        return
      }
      const result = await createBlock({
        tripId: trip.id,
        date: today,
        startTime: `${slot.startTime}:00`,
        endTime: `${slot.endTime}:00`,
        type: 'spot',
        spotId: rec.spot.id,
        title: rec.spot.name,
        memo: '',
        tripStartDate: trip.start_date,
        tripEndDate: trip.end_date,
      })
      if (result.error) setError(result.error)
      else setSyncedAt(new Date())
    })
  }

  const shift = (block: PlanBlock, deltaMinutes: number) => {
    setError(null)
    startTransition(async () => {
      const result = await shiftBlock(block.id, trip.id, deltaMinutes)
      if (result.error) setError(result.error)
      else setSyncedAt(new Date())
    })
  }

  if (!inTripPeriod) {
    return (
      <section className="mx-auto max-w-md space-y-4 text-center">
        <p className="text-muted-foreground">
          오늘({today})은 여행 기간({trip.start_date} – {trip.end_date})이 아닙니다.
        </p>
        <Button variant="outline" render={<Link href={`/trips/${trip.id}/plan`}>플랜 보기</Link>} />
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-md space-y-6 pb-24">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{today}</h2>
          <p className="text-xs text-muted-foreground">마지막 동기화 {formatClock(syncedAt)}</p>
        </div>
      </header>

      <div className="space-y-2">
        <div className="rounded-lg border p-4">
          <p className="text-xs font-medium text-muted-foreground">현재 일정</p>
          {currentBlock ? (
            <p className="mt-1 font-medium">
              {currentBlock.title}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {currentBlock.start_time.slice(0, 5)}–{currentBlock.end_time.slice(0, 5)}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">진행 중인 일정이 없습니다.</p>
          )}
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs font-medium text-muted-foreground">다음 일정</p>
          {nextBlock ? (
            <p className="mt-1 font-medium">
              {nextBlock.title}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {nextBlock.start_time.slice(0, 5)} 시작 · {remainingToNext}분 남음
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">오늘 남은 일정이 없습니다.</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">오늘 일정</h3>
        {todayBlocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">오늘 배치된 일정이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {todayBlocks.map((block) => {
              const spot = block.spot_id ? spotById.get(block.spot_id) : null
              const mapUrl = spot ? directionsUrl(spot) : null
              return (
                <li key={block.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{block.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {block.start_time.slice(0, 5)}–{block.end_time.slice(0, 5)} ·{' '}
                        {TYPE_LABELS[block.type]}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        className="min-h-11 px-3"
                        disabled={isPending}
                        onClick={() => shift(block, -15)}
                      >
                        −15분
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-11 px-3"
                        disabled={isPending}
                        onClick={() => shift(block, 15)}
                      >
                        +15분
                      </Button>
                    </div>
                  </div>
                  {mapUrl && (
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex min-h-11 items-center text-sm text-blue-700 underline underline-offset-2"
                    >
                      길찾기 ↗
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium">지금 갈 만한 곳</h3>
        {anchor ? (
          <p className="mb-2 text-xs text-muted-foreground">
            기준: {ANCHOR_SOURCE_LABELS[anchor.source]} · {anchor.label} — 거리는 직선거리 기준
            추정이라 실제 경로와 다를 수 있어요.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            기준점을 잡을 오늘 일정이 없어 추천을 만들 수 없습니다. 플랜에서 일정을 먼저
            배치해 보세요.
          </p>
        )}
        {anchor && recommendations.length === 0 && (
          <p className="text-sm text-muted-foreground">추천할 미방문 후보가 없습니다.</p>
        )}
        <ul className="space-y-2">
          {recommendations.map((rec) => {
            const mapUrl = directionsUrl(rec.spot)
            return (
              <li key={rec.spot.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 truncate font-medium">{rec.spot.name}</p>
                  {rec.spot.priority && <span aria-label="우선순위">★</span>}
                  {!rec.fitsBeforeNext && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
                      다음 일정 전엔 빠듯해요
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {rec.distanceKm.toFixed(1)}km · 도보 약 {rec.walkMin}분
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    className="min-h-11 flex-1"
                    disabled={isPending}
                    onClick={() => addToToday(rec)}
                  >
                    오늘 일정에 추가
                  </Button>
                  {mapUrl && (
                    <Button
                      variant="outline"
                      className="min-h-11"
                      render={
                        <a href={mapUrl} target="_blank" rel="noreferrer">
                          길찾기
                        </a>
                      }
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="fixed inset-x-0 bottom-0 border-t bg-background p-3">
        <div className="mx-auto flex max-w-md gap-2">
          <Button className="min-h-11 flex-1" disabled={isPending} onClick={refresh}>
            새로고침
          </Button>
          <Button
            variant="outline"
            className="min-h-11 flex-1"
            render={<Link href={`/trips/${trip.id}/plan`}>플랜 보기</Link>}
          />
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: TripNav의 Today 자리 표시자를 링크로 교체** — `src/app/trips/[tripId]/trip-nav.tsx` 전체:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function TripNav({ tripId }: { tripId: number }) {
  const pathname = usePathname()
  const isPlan = pathname?.startsWith(`/trips/${tripId}/plan`)
  const isToday = pathname?.startsWith(`/trips/${tripId}/today`)
  const isMembers = pathname?.startsWith(`/trips/${tripId}/members`)

  return (
    <nav className="mb-6 flex gap-4 border-b pb-2 text-sm">
      <Link
        href={`/trips/${tripId}/plan`}
        className={isPlan ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}
      >
        플랜
      </Link>
      <Link
        href={`/trips/${tripId}/today`}
        className={isToday ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}
      >
        Today
      </Link>
      <Link
        href={`/trips/${tripId}/members`}
        className={isMembers ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}
      >
        멤버
      </Link>
    </nav>
  )
}
```

- [ ] **Step 4: 홈 트립 카드의 Today CTA를 실제 링크로** — `src/app/home/page.tsx`의 트립 목록 `<li>`를 다음으로 교체 (CTA가 카드 링크 안에 중첩되지 않도록 형제 링크로 분리):

```tsx
          {trips.map((trip) => (
            <li key={trip.id} className="rounded-lg border">
              <Link href={`/trips/${trip.id}`} className="block rounded-t-lg p-4 hover:bg-accent">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{trip.title}</span>
                  {isTripInProgress(trip) && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                      여행 중
                    </span>
                  )}
                </div>
                <span className="text-sm text-muted-foreground">
                  {trip.start_date} – {trip.end_date}
                </span>
              </Link>
              {isTripInProgress(trip) && (
                <Link
                  href={`/trips/${trip.id}/today`}
                  className="block rounded-b-lg border-t px-4 py-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  지금 Today 모드 보기 →
                </Link>
              )}
            </li>
          ))}
```

- [ ] **Step 5: 타입체크·린트·빌드 확인**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: 에러 없음

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/\[tripId\]/today src/app/trips/\[tripId\]/trip-nav.tsx src/app/home/page.tsx
git commit -m "feat: add Today mode screen with recommendations, one-tap insert, and deeplinks"
```

---

### Task 6: 영업 중 배지 (Places 영업시간 세션 조회)

**Files:**
- Create: `src/lib/places/use-open-now.ts`
- Modify: `src/app/trips/[tripId]/today/today-view.tsx`

**Interfaces:**
- Consumes: Task 5의 추천 리스트 렌더링, `MapProvider`(이미 today/page.tsx가 감쌈 — API 키 없으면 훅이 조용히 빈 결과 반환)
- Produces: `useOpenNow(placeIds: string[]): Record<string, boolean | null>` — place_id별 현재 영업 여부, 알 수 없으면 `null`

- [ ] **Step 1: 훅 작성** — `src/lib/places/use-open-now.ts`:

```ts
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMapsLibrary } from '@vis.gl/react-google-maps'

// PRD §5: Places 상세(영업시간)는 영속 저장하지 않고 조회 시점에 place_id로
// 재조회한다. 캐시는 세션(모듈 스코프) 한정.
const sessionCache = new Map<string, boolean | null>()

export function useOpenNow(placeIds: string[]): Record<string, boolean | null> {
  const placesLib = useMapsLibrary('places')
  const [statuses, setStatuses] = useState<Record<string, boolean | null>>({})
  const cacheKey = useMemo(() => placeIds.join(','), [placeIds])

  useEffect(() => {
    if (!placesLib || placeIds.length === 0) return
    let cancelled = false

    ;(async () => {
      const next: Record<string, boolean | null> = {}
      for (const id of placeIds) {
        const cached = sessionCache.get(id)
        if (cached !== undefined) {
          next[id] = cached
          continue
        }
        try {
          const place = new placesLib.Place({ id })
          await place.fetchFields({ fields: ['regularOpeningHours', 'utcOffsetMinutes'] })
          const open = await place.isOpen()
          const value = open === undefined ? null : open
          sessionCache.set(id, value)
          next[id] = value
        } catch {
          sessionCache.set(id, null)
          next[id] = null
        }
      }
      if (!cancelled) setStatuses(next)
    })()

    return () => {
      cancelled = true
    }
    // placeIds 배열은 렌더마다 새 참조라 join한 cacheKey로 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesLib, cacheKey])

  return statuses
}
```

- [ ] **Step 2: 추천 리스트에 배지 연결** — `today-view.tsx` 수정.

import 추가:

```tsx
import { useOpenNow } from '@/lib/places/use-open-now'
```

`recommendations` 계산 아래에 추가:

```tsx
  const recommendedPlaceIds = useMemo(
    () =>
      recommendations
        .map((rec) => rec.spot.place_id)
        .filter((id): id is string => id != null),
    // recommendations는 렌더마다 새로 계산되므로 id 목록 문자열로 안정화한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recommendations.map((rec) => rec.spot.place_id).join(',')]
  )
  const openStatuses = useOpenNow(recommendedPlaceIds)
```

(파일 상단 `useState` import 라인에 `useMemo` 추가: `import { useEffect, useMemo, useState, useTransition } from 'react'`)

추천 항목의 이름 행(`{!rec.fitsBeforeNext && …}` 바로 뒤)에 배지 추가:

```tsx
                  {rec.spot.place_id && openStatuses[rec.spot.place_id] === true && (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">
                      영업 중
                    </span>
                  )}
                  {rec.spot.place_id && openStatuses[rec.spot.place_id] === false && (
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                      영업 종료
                    </span>
                  )}
```

- [ ] **Step 3: 타입체크·린트 확인**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/lib/places/use-open-now.ts src/app/trips/\[tripId\]/today/today-view.tsx
git commit -m "feat: show open-now badge on Today recommendations via session-cached Places lookup"
```

---

### Task 7: Realtime 마이그레이션 — publication + updated_by

**Files:**
- Create: `supabase/migrations/20260804000000_m3_realtime.sql`
- Modify: `src/types/database.ts`

**Interfaces:**
- Produces: `spots`/`plan_blocks`/`spot_groups`가 `supabase_realtime` publication에 포함되어 postgres_changes 이벤트를 발행. `spots.updated_by`/`plan_blocks.updated_by` (uuid, 트리거로 `auth.uid()` 자동 기록). 타입: `Spot.updated_by: string | null`, `PlanBlock.updated_by: string | null`

- [ ] **Step 1: 마이그레이션 작성** — `supabase/migrations/20260804000000_m3_realtime.sql`:

```sql
-- M3 (F7): 준실시간 동기화 기반.
--
-- 1) postgres_changes를 받으려면 테이블이 supabase_realtime publication에 있어야
--    한다. Realtime은 구독자의 JWT로 RLS를 평가하므로 트립 멤버가 아닌 사용자는
--    이벤트를 받지 못한다 (기존 select 정책 재사용).
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
```

- [ ] **Step 2: 타입 추가** — `src/types/database.ts`의 `Spot`과 `PlanBlock` 인터페이스 각각에 (`updated_at` 아래) 추가:

```ts
  updated_by: string | null
```

- [ ] **Step 2b: 전체 리터럴을 만드는 테스트 팩토리 갱신** — 필수 필드가 늘었으므로 `Spot`/`PlanBlock` 전체 객체를 조립하는 팩토리에 `updated_by: null`을 추가한다 (`updated_at` 라인 아래):
  - `src/app/trips/[tripId]/plan/map-view.test.ts`의 `block()`과 `locatedSpot()`
  - `src/lib/today/engine.test.ts`의 `block()`과 `spot()` (Task 1에서 생성)

  확인: `pnpm exec tsc --noEmit` → 에러 없음

- [ ] **Step 3: 로컬 DB에 적용하고 전체 테스트**

Run: `npx supabase db reset && pnpm test`
Expected: 마이그레이션 적용 성공, RLS 테스트 포함 전체 PASS. (로컬 Supabase가 없으면 `npx supabase start` 먼저. 도커가 아예 없으면 이 단계는 `pnpm test -- src/lib`로 대체하고 커밋 메시지에 미검증 사실을 남기지 말 것 — 반드시 로컬 검증을 시도한다.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260804000000_m3_realtime.sql src/types/database.ts
git commit -m "feat: publish trip tables to Realtime and record updated_by for overwrite detection"
```

---

### Task 8: 덮어쓰기 감지 순수 로직

**Files:**
- Create: `src/lib/realtime/overwrite.ts`
- Test: `src/lib/realtime/overwrite.test.ts`

**Interfaces:**
- Produces: `RECENT_EDIT_WINDOW_MS = 60_000`, `type EditKey = string`, `makeKey(table: string, id: number): EditKey`, `pruneEdits(edits: Map<EditKey, number>, now: number): void`, `shouldNotifyOverwrite(params: { edits: Map<EditKey, number>; table: string; recordId: number; editorId: string | null; myUserId: string; now: number }): boolean`

- [ ] **Step 1: Write the failing test** — `src/lib/realtime/overwrite.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  RECENT_EDIT_WINDOW_MS,
  makeKey,
  pruneEdits,
  shouldNotifyOverwrite,
} from './overwrite'

const ME = 'user-me'
const OTHER = 'user-other'

function editsWith(table: string, id: number, at: number) {
  return new Map([[makeKey(table, id), at]])
}

describe('shouldNotifyOverwrite', () => {
  it('notifies when another member updates a record I edited within the window', () => {
    expect(
      shouldNotifyOverwrite({
        edits: editsWith('plan_blocks', 1, 1_000),
        table: 'plan_blocks',
        recordId: 1,
        editorId: OTHER,
        myUserId: ME,
        now: 1_000 + RECENT_EDIT_WINDOW_MS,
      })
    ).toBe(true)
  })

  it('ignores my own write echo', () => {
    expect(
      shouldNotifyOverwrite({
        edits: editsWith('plan_blocks', 1, 1_000),
        table: 'plan_blocks',
        recordId: 1,
        editorId: ME,
        myUserId: ME,
        now: 2_000,
      })
    ).toBe(false)
  })

  it('ignores records I did not recently edit', () => {
    expect(
      shouldNotifyOverwrite({
        edits: editsWith('plan_blocks', 1, 1_000),
        table: 'plan_blocks',
        recordId: 2,
        editorId: OTHER,
        myUserId: ME,
        now: 2_000,
      })
    ).toBe(false)
    expect(
      shouldNotifyOverwrite({
        edits: editsWith('spots', 1, 1_000),
        table: 'plan_blocks',
        recordId: 1,
        editorId: OTHER,
        myUserId: ME,
        now: 2_000,
      })
    ).toBe(false)
  })

  it('ignores edits older than the window and unknown editors', () => {
    expect(
      shouldNotifyOverwrite({
        edits: editsWith('plan_blocks', 1, 1_000),
        table: 'plan_blocks',
        recordId: 1,
        editorId: OTHER,
        myUserId: ME,
        now: 1_001 + RECENT_EDIT_WINDOW_MS,
      })
    ).toBe(false)
    expect(
      shouldNotifyOverwrite({
        edits: editsWith('plan_blocks', 1, 1_000),
        table: 'plan_blocks',
        recordId: 1,
        editorId: null,
        myUserId: ME,
        now: 2_000,
      })
    ).toBe(false)
  })
})

describe('pruneEdits', () => {
  it('drops entries older than the window, keeps fresh ones', () => {
    const edits = new Map([
      [makeKey('plan_blocks', 1), 0],
      [makeKey('plan_blocks', 2), 50_000],
    ])
    pruneEdits(edits, 70_000)
    expect(edits.has(makeKey('plan_blocks', 1))).toBe(false)
    expect(edits.has(makeKey('plan_blocks', 2))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/realtime/overwrite.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: Write minimal implementation** — `src/lib/realtime/overwrite.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/realtime/overwrite.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime/overwrite.ts src/lib/realtime/overwrite.test.ts
git commit -m "feat: add overwrite-detection logic for realtime conflict toasts"
```

---

### Task 9: TripRealtimeProvider — 구독·프레즌스·토스트 연결

**Files:**
- Create: `src/lib/realtime/trip-realtime.tsx`
- Modify: `src/app/layout.tsx` (sonner Toaster)
- Modify: `src/app/trips/[tripId]/layout.tsx` (Provider + 프레즌스 아바타)
- Modify: `src/app/trips/[tripId]/plan/block-dialog.tsx` (markEdited)
- Modify: `src/app/trips/[tripId]/today/today-view.tsx` (markEdited + lastSyncedAt)

**Interfaces:**
- Consumes: Task 7의 publication/`updated_by`, Task 8의 `makeKey`/`pruneEdits`/`shouldNotifyOverwrite`, `@/lib/supabase/client`의 `createClient`
- Produces: `TripRealtimeProvider({ tripId, userId, userEmail, memberEmailsByUserId, children })`, `useTripRealtime(): { lastSyncedAt: Date | null; onlineEmails: string[]; markEdited: (table: 'plan_blocks' | 'spots', id: number) => void }` (Provider 밖에서는 no-op 기본값), `PresenceAvatars()` 컴포넌트

- [ ] **Step 1: sonner 설치**

Run: `pnpm add sonner`
Expected: dependencies에 sonner 추가

- [ ] **Step 2: Provider 작성** — `src/lib/realtime/trip-realtime.tsx`:

```tsx
'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { makeKey, pruneEdits, shouldNotifyOverwrite, type EditKey } from './overwrite'

interface TripRealtimeContextValue {
  lastSyncedAt: Date | null
  onlineEmails: string[]
  markEdited: (table: 'plan_blocks' | 'spots', id: number) => void
}

const TripRealtimeContext = createContext<TripRealtimeContextValue>({
  lastSyncedAt: null,
  onlineEmails: [],
  markEdited: () => {},
})

export function useTripRealtime(): TripRealtimeContextValue {
  return useContext(TripRealtimeContext)
}

const REALTIME_TABLES = ['plan_blocks', 'spots', 'spot_groups'] as const
const REFRESH_DEBOUNCE_MS = 300

export function TripRealtimeProvider({
  tripId,
  userId,
  userEmail,
  memberEmailsByUserId,
  children,
}: {
  tripId: number
  userId: string
  userEmail: string
  memberEmailsByUserId: Record<string, string>
  children: React.ReactNode
}) {
  const router = useRouter()
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [onlineEmails, setOnlineEmails] = useState<string[]>([])
  const editsRef = useRef(new Map<EditKey, number>())
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // memberEmailsByUserId는 서버 컴포넌트가 렌더마다 새 객체로 넘기므로 effect
  // 의존성에 넣으면 매 렌더 재구독한다 — ref로 참조만 갈아끼운다.
  const membersRef = useRef(memberEmailsByUserId)
  membersRef.current = memberEmailsByUserId

  const markEdited = useCallback((table: 'plan_blocks' | 'spots', id: number) => {
    pruneEdits(editsRef.current, Date.now())
    editsRef.current.set(makeKey(table, id), Date.now())
  }, [])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`trip-${tripId}`, {
      config: { presence: { key: userEmail } },
    })

    for (const table of REALTIME_TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `trip_id=eq.${tripId}` },
        (payload) => {
          setLastSyncedAt(new Date())

          if (payload.eventType === 'UPDATE') {
            const record = payload.new as { id?: number; updated_by?: string | null }
            if (
              record.id != null &&
              shouldNotifyOverwrite({
                edits: editsRef.current,
                table,
                recordId: record.id,
                editorId: record.updated_by ?? null,
                myUserId: userId,
                now: Date.now(),
              })
            ) {
              const editorEmail = record.updated_by
                ? membersRef.current[record.updated_by]
                : undefined
              toast(`${editorEmail ?? '다른 멤버'}님이 방금 이 항목을 수정했어요`)
            }
          }

          // 이벤트가 몰릴 때 refresh 폭주를 막는 디바운스. 서버 컴포넌트 재조회로
          // 화면을 갱신하므로 레코드 단위 병합이 필요 없다 (LWW: DB 상태가 곧 최종).
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
          refreshTimerRef.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS)
        }
      )
    }

    channel.on('presence', { event: 'sync' }, () => {
      setOnlineEmails(Object.keys(channel.presenceState()))
    })

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        setLastSyncedAt(new Date())
        await channel.track({ online_at: new Date().toISOString() })
      }
    })

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      supabase.removeChannel(channel)
    }
  }, [tripId, userId, userEmail, router])

  return (
    <TripRealtimeContext.Provider value={{ lastSyncedAt, onlineEmails, markEdited }}>
      {children}
    </TripRealtimeContext.Provider>
  )
}

export function PresenceAvatars() {
  const { onlineEmails } = useTripRealtime()
  if (onlineEmails.length === 0) return null

  return (
    <div className="flex -space-x-2" aria-label="현재 접속 중인 멤버">
      {onlineEmails.map((email) => (
        <span
          key={email}
          title={email}
          className="flex size-7 items-center justify-center rounded-full border bg-secondary text-xs font-medium"
        >
          {email[0]?.toUpperCase() ?? '?'}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: 루트 레이아웃에 Toaster 추가** — `src/app/layout.tsx`:

```tsx
import { Toaster } from 'sonner'
```

body를 다음으로 교체:

```tsx
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster position="top-center" />
      </body>
```

- [ ] **Step 4: 트립 레이아웃에서 Provider로 감싸고 프레즌스 표시** — `src/app/trips/[tripId]/layout.tsx` 전체:

```tsx
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTrip, listTripMembers } from '@/lib/trips/queries'
import { TripRealtimeProvider, PresenceAvatars } from '@/lib/realtime/trip-realtime'
import { TripNav } from './trip-nav'

export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tripId: string }>
}) {
  const { tripId } = await params
  if (!/^\d+$/.test(tripId)) notFound()
  const numericTripId = Number(tripId)

  const trip = await getTrip(numericTripId)
  if (!trip) notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const members = await listTripMembers(trip.id)
  const memberEmailsByUserId = Object.fromEntries(
    members
      .filter((member) => member.user_id != null)
      .map((member) => [member.user_id as string, member.invited_email])
  )

  return (
    <TripRealtimeProvider
      tripId={trip.id}
      userId={user.id}
      userEmail={user.email ?? ''}
      memberEmailsByUserId={memberEmailsByUserId}
    >
      <main className="mx-auto max-w-5xl p-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{trip.title}</h1>
            <p className="text-sm text-muted-foreground">
              {trip.start_date} – {trip.end_date}
            </p>
          </div>
          <PresenceAvatars />
        </header>

        <TripNav tripId={trip.id} />

        {children}
      </main>
    </TripRealtimeProvider>
  )
}
```

- [ ] **Step 5: BlockDialog에 markEdited 연동** — `src/app/trips/[tripId]/plan/block-dialog.tsx`.

import 추가:

```tsx
import { useTripRealtime } from '@/lib/realtime/trip-realtime'
```

컴포넌트 본문 상단(`const [title, setTitle] = …` 위)에:

```tsx
  const { markEdited } = useTripRealtime()
```

`submit`의 성공 분기(`onOpenChange(false)` 직전)에 편집 기록 추가 — 기존:

```tsx
      if (result.error) {
        setError(result.error)
      } else {
        onOpenChange(false)
      }
```

을 다음으로 교체:

```tsx
      if (result.error) {
        setError(result.error)
      } else {
        if (editingBlock) markEdited('plan_blocks', editingBlock.id)
        onOpenChange(false)
      }
```

- [ ] **Step 6: TodayView에 markEdited·lastSyncedAt 연동** — `today-view.tsx`.

import 추가:

```tsx
import { useTripRealtime } from '@/lib/realtime/trip-realtime'
```

컴포넌트 상단 state 아래에:

```tsx
  const { lastSyncedAt, markEdited } = useTripRealtime()
```

동기화 표기를 realtime 수신 시각 우선으로 — 기존:

```tsx
          <p className="text-xs text-muted-foreground">마지막 동기화 {formatClock(syncedAt)}</p>
```

을 다음으로 교체:

```tsx
          <p className="text-xs text-muted-foreground">
            마지막 동기화 {formatClock(lastSyncedAt ?? syncedAt)}
          </p>
```

`shift`의 성공 분기 — 기존:

```tsx
      if (result.error) setError(result.error)
      else setSyncedAt(new Date())
```

(shift 함수 안의 것) 을 다음으로 교체:

```tsx
      if (result.error) {
        setError(result.error)
      } else {
        markEdited('plan_blocks', block.id)
        setSyncedAt(new Date())
      }
```

- [ ] **Step 7: 타입체크·린트·전체 테스트·빌드**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: 전부 통과 (RLS 테스트는 로컬 Supabase 필요 — Task 7에서 이미 리셋함)

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/realtime/trip-realtime.tsx src/app/layout.tsx src/app/trips/\[tripId\]/layout.tsx src/app/trips/\[tripId\]/plan/block-dialog.tsx src/app/trips/\[tripId\]/today/today-view.tsx
git commit -m "feat: add realtime sync with presence avatars and overwrite toasts"
```

---

### Task 10: 최종 검증

**Files:** (수정 없음 — 검증만)

- [ ] **Step 1: 전체 자동 검증**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: 전부 통과

- [ ] **Step 2: 수동 검증 (dev 서버 + 브라우저)**

`pnpm dev` 후:
1. 홈: 여행 중인 트립 카드에 "지금 Today 모드 보기 →"가 별도 링크로 보이고 `/trips/{id}/today`로 이동하는지.
2. Today: 오늘 날짜·마지막 동기화 표시, 현재/다음 일정 카드, 오늘 일정 리스트의 ±15분 버튼 동작, 길찾기 링크가 구글맵 새 탭으로 열리는지.
3. 추천: 기준점 라벨 표시, 거리순 정렬, "오늘 일정에 추가" 원탭 → 리스트에 즉시 반영(빈 슬롯에 배치), API 키가 있으면 영업 중/종료 배지.
4. Realtime: 브라우저 두 개(일반+시크릿, 서로 다른 멤버 계정)로 같은 트립을 열고 — (a) 한쪽에서 블록 생성 시 다른 쪽 플랜/Today가 수 초 내 자동 갱신, (b) 헤더에 두 명의 프레즌스 아바타, (c) A가 블록 수정 직후 B가 같은 블록을 수정하면 A에게 "…님이 방금 이 항목을 수정했어요" 토스트.
5. 여행 기간 밖 트립의 Today: 기간 아님 안내 + 플랜 링크.

- [ ] **Step 3: 결과 요약 보고** (변경 요약, 검증 결과, 알려진 한계 — PRD 대비 의도적 축소: 숙소 fallback은 lodgings 테이블 미구현으로 lodging 블록/스팟 대체, 영업시간 배지는 best-effort)

## PRD 대비 의도적 스코프 결정

- **기준점 fallback의 "당일 숙소"**: `lodgings` 테이블이 아직 없으므로(F2/F4 잔여 작업) 오늘의 `lodging` 타입 블록 → `lodging` 카테고리 스팟 순으로 대체한다. lodgings 도입 시 `resolveAnchor`만 교체하면 된다.
- **영업시간 필터·정렬**: PRD §5(세션 캐시, 조회 시점 재조회)를 지키기 위해 클라이언트에서 상위 8개 추천만 조회하고, 정렬 기준이 아니라 배지로 보여준다. API 키가 없거나 조회 실패 시 조용히 생략.
- **동기화 반영 방식**: postgres_changes 수신 → `router.refresh()`(디바운스 300ms). 레코드 단위 캐시 병합보다 단순하고, 서버 컴포넌트 fetch 구조를 그대로 재사용한다. "수 초 이내 반영"(성공 기준 §8) 충족.
- **덮어쓰기 토스트의 편집자 표시**: `updated_by`를 트리거로 기록하고 트립 멤버 이메일로 표시한다. 멤버 목록에 없는 편집자(이론상 없음)는 "다른 멤버"로 표기.
