# F4: 타임라인 캘린더형 편집 (드래그앤드롭·Undo·이동시간 힌트·모바일) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRD F4의 미구현 요구를 완성한다 — 캘린더형 편집(드래그 생성·이동·리사이즈, 15분 스냅), 편집 직후 Undo 토스트, 연속 블록 간 직선거리 기반 이동시간 힌트, 도시 그룹핑 헤더, 모바일 일 단위 리스트 뷰.

**Architecture:** 드래그는 dnd-kit이 아니라 **포인터 이벤트 + 순수 스냅/클램프 함수**로 구현한다(시간 그리드 캘린더에는 리스트 정렬용 dnd-kit보다 좌표 계산이 단순·정확하고, 수학이 전부 순수 함수라 vitest로 검증 가능). 순수 로직은 `src/lib/timeline/`에 두고 TDD, `TimelineView`는 이를 소비해 낙관적 오버라이드(pendingTimes)로 스냅백 없이 렌더링한다. Undo는 sonner 토스트 action으로 역방향 서버 액션을 호출한다. 미사용 dnd-kit 의존성 3개는 제거한다.

**Tech Stack:** React 포인터 이벤트, sonner(이미 도입됨), 기존 `updateBlock`/`deleteBlock` 서버 액션, `@/lib/today/engine`의 `haversineKm`/`walkMinutes`/`timeToMinutes`/`minutesToTime` 재사용.

## Global Constraints

- UI 카피는 한국어. 서버 액션 실패 메시지 패턴 유지: `'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'`
- 스냅 단위 15분(`SNAP_MINUTES = 15`), 최소 블록 길이 15분, 하루 범위 0–1440분. 그리드 시각 밀도는 기존 유지(30분 슬롯 × 28px → `PX_PER_MINUTE = 28/30`).
- 이동시간 힌트는 직선거리 기반 추정임을 UI에 명시한다(PRD F4). 도보 속도는 engine의 `walkMinutes`(4.5km/h) 재사용.
- 시간 문자열: 렌더·다이얼로그는 'HH:MM', DB로 보낼 때 `:00`을 붙여 'HH:MM:SS'.
- 순수 함수만 단위 테스트(vitest node). React 컴포넌트/포인터 상호작용은 테스트하지 않는다(기존 관례). RLS 테스트는 로컬 Supabase 필요.
- 기존 export 유지: `timeline-view.tsx`의 `enumerateDates`(timeline-view.test.ts가 참조).
- Undo/편집 성공 시 `markEdited('plan_blocks', id)` 호출(F7 덮어쓰기 감지 연동, `useTripRealtime()` 사용).
- 인라인 팝오버 편집은 이번에도 모달(BlockDialog)로 대체 유지 — 기존 plan 문서에 기록된 의도적 치환이며 이 플랜의 범위가 아니다.
- 커밋 메시지 관례(`feat:`/`fix:`/`chore:`) + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
src/lib/timeline/grid.ts              # 스냅·클램프·드래그 범위 계산 (신규, TDD)
src/lib/timeline/grid.test.ts
src/lib/timeline/travel-hints.ts      # 연속 블록 이동시간 힌트 (신규, TDD)
src/lib/timeline/travel-hints.test.ts
src/lib/timeline/city-header.ts       # 날짜별 도시 라벨·스팬 (신규, TDD)
src/lib/timeline/city-header.test.ts
src/lib/plan-blocks/actions.ts        # createBlock이 blockId 반환 (수정)
src/app/trips/[tripId]/plan/timeline-view.tsx  # 전면 재작성
src/app/trips/[tripId]/plan/plan-canvas.tsx    # TimelineView에 groups 전달 (수정)
src/app/trips/[tripId]/plan/block-dialog.tsx   # 생성/삭제 Undo 토스트 (수정)
src/app/trips/[tripId]/plan/page.tsx           # 모바일 스택 레이아웃 (수정)
package.json                          # dnd-kit 3개 제거
```

---

### Task 1: 그리드 순수 로직 — 스냅·클램프·드래그 범위

**Files:**
- Create: `src/lib/timeline/grid.ts`
- Test: `src/lib/timeline/grid.test.ts`

**Interfaces:**
- Produces: `SNAP_MINUTES = 15`, `MIN_BLOCK_MINUTES = 15`, `DAY_MINUTES = 1440`, `snapMinutes(minutes: number): number`, `clampMinutes(m: number, min?: number, max?: number): number`, `pxToMinutes(px: number, pxPerMinute: number): number`, `dragCreateRange(anchorPx: number, currentPx: number, pxPerMinute: number): { startMin: number; endMin: number }`, `moveRange(startMin: number, endMin: number, deltaPx: number, pxPerMinute: number): { startMin: number; endMin: number }`, `resizeRange(startMin: number, endMin: number, edge: 'top' | 'bottom', deltaPx: number, pxPerMinute: number): { startMin: number; endMin: number }`

- [ ] **Step 1: Write the failing test** — `src/lib/timeline/grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DAY_MINUTES,
  MIN_BLOCK_MINUTES,
  dragCreateRange,
  moveRange,
  pxToMinutes,
  resizeRange,
  snapMinutes,
} from './grid'

// 그리드는 30분 슬롯 × 28px → 1분당 28/30px
const PPM = 28 / 30

describe('snapMinutes / pxToMinutes', () => {
  it('snaps to 15-minute steps', () => {
    expect(snapMinutes(0)).toBe(0)
    expect(snapMinutes(7)).toBe(0)
    expect(snapMinutes(8)).toBe(15)
    expect(snapMinutes(22)).toBe(15)
    expect(snapMinutes(23)).toBe(30)
  })

  it('converts px to snapped minutes clamped to the day', () => {
    expect(pxToMinutes(0, PPM)).toBe(0)
    expect(pxToMinutes(28, PPM)).toBe(30)
    expect(pxToMinutes(14, PPM)).toBe(15)
    expect(pxToMinutes(-10, PPM)).toBe(0)
    expect(pxToMinutes(100_000, PPM)).toBe(DAY_MINUTES)
  })
})

describe('dragCreateRange', () => {
  it('orders anchor/current and snaps both ends', () => {
    // 9:00(504px) → 10:30(984px≈)
    expect(dragCreateRange(9 * 60 * PPM, 10.5 * 60 * PPM, PPM)).toEqual({
      startMin: 540,
      endMin: 630,
    })
    // 아래에서 위로 드래그해도 동일
    expect(dragCreateRange(10.5 * 60 * PPM, 9 * 60 * PPM, PPM)).toEqual({
      startMin: 540,
      endMin: 630,
    })
  })

  it('enforces the minimum block length', () => {
    const px = 9 * 60 * PPM
    expect(dragCreateRange(px, px + 2, PPM)).toEqual({
      startMin: 540,
      endMin: 540 + MIN_BLOCK_MINUTES,
    })
  })

  it('keeps the range inside the day at the bottom edge', () => {
    const bottom = DAY_MINUTES * PPM
    const range = dragCreateRange(bottom, bottom, PPM)
    expect(range.endMin).toBe(DAY_MINUTES)
    expect(range.startMin).toBe(DAY_MINUTES - MIN_BLOCK_MINUTES)
  })
})

describe('moveRange', () => {
  it('shifts preserving duration with snapping', () => {
    // 9:00–10:00을 +20분어치 px만큼: snap(560) = round(560/15)*15 = 555
    expect(moveRange(540, 600, 20 * PPM, PPM)).toEqual({ startMin: 555, endMin: 615 })
    expect(moveRange(540, 600, -20 * PPM, PPM)).toEqual({ startMin: 525, endMin: 585 })
  })

  it('clamps to day bounds preserving duration', () => {
    expect(moveRange(0, 60, -100 * PPM, PPM)).toEqual({ startMin: 0, endMin: 60 })
    expect(moveRange(DAY_MINUTES - 60, DAY_MINUTES, 100 * PPM, PPM)).toEqual({
      startMin: DAY_MINUTES - 60,
      endMin: DAY_MINUTES,
    })
  })
})

describe('resizeRange', () => {
  it('resizes the chosen edge with snapping', () => {
    expect(resizeRange(540, 600, 'bottom', 30 * PPM, PPM)).toEqual({ startMin: 540, endMin: 630 })
    expect(resizeRange(540, 600, 'top', -30 * PPM, PPM)).toEqual({ startMin: 510, endMin: 600 })
  })

  it('never shrinks below the minimum length', () => {
    expect(resizeRange(540, 600, 'bottom', -300 * PPM, PPM)).toEqual({
      startMin: 540,
      endMin: 540 + MIN_BLOCK_MINUTES,
    })
    expect(resizeRange(540, 600, 'top', 300 * PPM, PPM)).toEqual({
      startMin: 600 - MIN_BLOCK_MINUTES,
      endMin: 600,
    })
  })

  it('clamps to day bounds', () => {
    expect(resizeRange(540, 600, 'bottom', 10_000, PPM).endMin).toBe(DAY_MINUTES)
    expect(resizeRange(540, 600, 'top', -10_000, PPM).startMin).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/timeline/grid.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: Write minimal implementation** — `src/lib/timeline/grid.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/timeline/grid.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline/grid.ts src/lib/timeline/grid.test.ts
git commit -m "feat: add timeline grid snapping math for calendar-style editing"
```

---

### Task 2: 이동시간 힌트 순수 로직

**Files:**
- Create: `src/lib/timeline/travel-hints.ts`
- Test: `src/lib/timeline/travel-hints.test.ts`

**Interfaces:**
- Consumes: `@/lib/today/engine`의 `haversineKm`, `walkMinutes`, `timeToMinutes`
- Produces: `interface TravelHint { fromBlockId: number; toBlockId: number; boundaryMin: number; walkMin: number }`, `travelHints(dayBlocks: PlanBlock[], spotById: Map<number, Spot>): TravelHint[]` — 같은 날 좌표 있는 스팟 블록을 시작시간순으로 보고 연속 쌍마다 힌트 생성(`boundaryMin`은 다음 블록 시작 분). 같은 스팟 연속이면 생략.

- [ ] **Step 1: Write the failing test** — `src/lib/timeline/travel-hints.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PlanBlock, Spot } from '@/types/database'
import { travelHints } from './travel-hints'

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
    updated_by: null,
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
    lat: 45.4642,
    lng: 9.1919,
    address: null,
    memo: null,
    priority: false,
    est_cost: null,
    link: null,
    status: 'candidate',
    created_at: '',
    updated_at: '',
    updated_by: null,
    ...overrides,
  }
}

describe('travelHints', () => {
  it('creates a hint between consecutive located spot blocks', () => {
    const a = spot({ name: 'A', lat: 45.4642, lng: 9.1919 })
    const b = spot({ name: 'B', lat: 45.4705, lng: 9.1794 }) // ~1.1km
    const b1 = block({ start_time: '09:00:00', end_time: '10:00:00', spot_id: a.id })
    const b2 = block({ start_time: '11:00:00', end_time: '12:00:00', spot_id: b.id })
    const spotById = new Map([[a.id, a], [b.id, b]])

    const hints = travelHints([b2, b1], spotById) // 정렬은 함수 책임
    expect(hints).toHaveLength(1)
    expect(hints[0].fromBlockId).toBe(b1.id)
    expect(hints[0].toBlockId).toBe(b2.id)
    expect(hints[0].boundaryMin).toBe(11 * 60)
    expect(hints[0].walkMin).toBeGreaterThan(5)
    expect(hints[0].walkMin).toBeLessThan(30)
  })

  it('skips blocks without a located spot', () => {
    const a = spot({ name: 'A' })
    const noCoords = spot({ name: 'X', lat: null, lng: null })
    const b1 = block({ start_time: '09:00:00', spot_id: a.id })
    const b2 = block({ start_time: '11:00:00', spot_id: noCoords.id })
    const b3 = block({ start_time: '13:00:00', spot_id: null, type: 'memo' })
    const spotById = new Map([[a.id, a], [noCoords.id, noCoords]])
    expect(travelHints([b1, b2, b3], spotById)).toEqual([])
  })

  it('skips consecutive blocks at the same spot', () => {
    const a = spot({ name: 'A' })
    const b1 = block({ start_time: '09:00:00', spot_id: a.id })
    const b2 = block({ start_time: '11:00:00', spot_id: a.id })
    expect(travelHints([b1, b2], new Map([[a.id, a]]))).toEqual([])
  })

  it('chains hints across three located blocks', () => {
    const a = spot({ name: 'A', lat: 45.0, lng: 9.0 })
    const b = spot({ name: 'B', lat: 45.01, lng: 9.0 })
    const c = spot({ name: 'C', lat: 45.02, lng: 9.0 })
    const b1 = block({ start_time: '09:00:00', spot_id: a.id })
    const b2 = block({ start_time: '11:00:00', spot_id: b.id })
    const b3 = block({ start_time: '13:00:00', spot_id: c.id })
    const spotById = new Map([[a.id, a], [b.id, b], [c.id, c]])
    const hints = travelHints([b1, b2, b3], spotById)
    expect(hints.map((h) => [h.fromBlockId, h.toBlockId])).toEqual([
      [b1.id, b2.id],
      [b2.id, b3.id],
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/timeline/travel-hints.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: Write minimal implementation** — `src/lib/timeline/travel-hints.ts`:

```ts
import type { PlanBlock, Spot } from '@/types/database'
import { haversineKm, timeToMinutes, walkMinutes } from '@/lib/today/engine'

// PRD F4: 연속된 두 블록 사이의 이동 시간을 좌표 기반 직선거리로 추정해 참고
// 힌트로 보여준다(실제 도보 경로와 다를 수 있음은 UI가 명시).

export interface TravelHint {
  fromBlockId: number
  toBlockId: number
  boundaryMin: number
  walkMin: number
}

export function travelHints(
  dayBlocks: PlanBlock[],
  spotById: Map<number, Spot>
): TravelHint[] {
  const located = dayBlocks
    .map((block) => {
      if (block.spot_id == null) return null
      const spot = spotById.get(block.spot_id)
      if (!spot || spot.lat == null || spot.lng == null) return null
      return { block, spot }
    })
    .filter((x): x is { block: PlanBlock; spot: Spot } => x !== null)
    .sort((a, b) => a.block.start_time.localeCompare(b.block.start_time))

  const hints: TravelHint[] = []
  for (let i = 0; i + 1 < located.length; i++) {
    const from = located[i]
    const to = located[i + 1]
    if (from.spot.id === to.spot.id) continue
    const km = haversineKm(
      { lat: from.spot.lat!, lng: from.spot.lng! },
      { lat: to.spot.lat!, lng: to.spot.lng! }
    )
    hints.push({
      fromBlockId: from.block.id,
      toBlockId: to.block.id,
      boundaryMin: timeToMinutes(to.block.start_time),
      walkMin: walkMinutes(km),
    })
  }
  return hints
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/timeline/travel-hints.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline/travel-hints.ts src/lib/timeline/travel-hints.test.ts
git commit -m "feat: add straight-line travel-time hints between consecutive blocks"
```

---

### Task 3: 도시 그룹핑 헤더 순수 로직

**Files:**
- Create: `src/lib/timeline/city-header.ts`
- Test: `src/lib/timeline/city-header.test.ts`

**Interfaces:**
- Produces: `interface CitySpan { label: string | null; startIndex: number; length: number }`, `dominantGroupName(dateBlocks: PlanBlock[], spotById: Map<number, Spot>, groupNameById: Map<number, string>): string | null` (해당 날짜 블록들의 스팟 그룹 최빈값; 동률이면 먼저 등장한 그룹; 없으면 null), `cityHeaderSpans(dates: string[], blocks: PlanBlock[], spotById, groupNameById): CitySpan[]` (연속 동일 라벨 압축, null 라벨 스팬 포함)

- [ ] **Step 1: Write the failing test** — `src/lib/timeline/city-header.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PlanBlock, Spot } from '@/types/database'
import { cityHeaderSpans, dominantGroupName } from './city-header'

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
    updated_by: null,
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
    lat: null,
    lng: null,
    address: null,
    memo: null,
    priority: false,
    est_cost: null,
    link: null,
    status: 'candidate',
    created_at: '',
    updated_at: '',
    updated_by: null,
    ...overrides,
  }
}

const MILAN = 1
const FLORENCE = 2
const groupNameById = new Map([
  [MILAN, '밀라노'],
  [FLORENCE, '피렌체'],
])

describe('dominantGroupName', () => {
  it('picks the most frequent group among the day blocks', () => {
    const m1 = spot({ group_id: MILAN })
    const m2 = spot({ group_id: MILAN })
    const f1 = spot({ group_id: FLORENCE })
    const blocks = [
      block({ spot_id: m1.id }),
      block({ spot_id: m2.id }),
      block({ spot_id: f1.id }),
    ]
    const spotById = new Map([[m1.id, m1], [m2.id, m2], [f1.id, f1]])
    expect(dominantGroupName(blocks, spotById, groupNameById)).toBe('밀라노')
  })

  it('breaks ties by first appearance', () => {
    const f1 = spot({ group_id: FLORENCE })
    const m1 = spot({ group_id: MILAN })
    const blocks = [block({ spot_id: f1.id }), block({ spot_id: m1.id })]
    const spotById = new Map([[f1.id, f1], [m1.id, m1]])
    expect(dominantGroupName(blocks, spotById, groupNameById)).toBe('피렌체')
  })

  it('returns null when no block has a grouped spot', () => {
    const ungrouped = spot({ group_id: null })
    const blocks = [block({ spot_id: ungrouped.id }), block({ spot_id: null, type: 'memo' })]
    expect(dominantGroupName(blocks, new Map([[ungrouped.id, ungrouped]]), groupNameById)).toBeNull()
  })
})

describe('cityHeaderSpans', () => {
  it('compresses consecutive equal labels into spans', () => {
    const m = spot({ group_id: MILAN })
    const f = spot({ group_id: FLORENCE })
    const spotById = new Map([[m.id, m], [f.id, f]])
    const dates = ['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']
    const blocks = [
      block({ date: '2026-08-04', spot_id: m.id }),
      block({ date: '2026-08-05', spot_id: m.id }),
      block({ date: '2026-08-06', spot_id: f.id }),
      // 08-07은 블록 없음 → null 라벨
    ]
    expect(cityHeaderSpans(dates, blocks, spotById, groupNameById)).toEqual([
      { label: '밀라노', startIndex: 0, length: 2 },
      { label: '피렌체', startIndex: 2, length: 1 },
      { label: null, startIndex: 3, length: 1 },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/timeline/city-header.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: Write minimal implementation** — `src/lib/timeline/city-header.ts`:

```ts
import type { PlanBlock, Spot } from '@/types/database'

// PRD F4: 도시 단위 상단 그룹핑(예: 밀라노 2박). 날짜→도시 매핑이 별도 데이터로
// 존재하지 않으므로, 그 날짜에 배치된 스팟 블록들의 spot_group 최빈값을 그날의
// 도시로 삼는다(동률은 먼저 등장한 그룹, 없으면 null).

export interface CitySpan {
  label: string | null
  startIndex: number
  length: number
}

export function dominantGroupName(
  dateBlocks: PlanBlock[],
  spotById: Map<number, Spot>,
  groupNameById: Map<number, string>
): string | null {
  const counts = new Map<string, number>()
  const firstSeen = new Map<string, number>()
  let order = 0

  for (const block of dateBlocks) {
    if (block.spot_id == null) continue
    const spot = spotById.get(block.spot_id)
    if (!spot || spot.group_id == null) continue
    const name = groupNameById.get(spot.group_id)
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
    if (!firstSeen.has(name)) firstSeen.set(name, order++)
  }

  let best: string | null = null
  for (const [name, count] of counts) {
    if (
      best === null ||
      count > counts.get(best)! ||
      (count === counts.get(best)! && firstSeen.get(name)! < firstSeen.get(best)!)
    ) {
      best = name
    }
  }
  return best
}

export function cityHeaderSpans(
  dates: string[],
  blocks: PlanBlock[],
  spotById: Map<number, Spot>,
  groupNameById: Map<number, string>
): CitySpan[] {
  const labels = dates.map((date) =>
    dominantGroupName(
      blocks.filter((block) => block.date === date),
      spotById,
      groupNameById
    )
  )

  const spans: CitySpan[] = []
  labels.forEach((label, index) => {
    const last = spans[spans.length - 1]
    if (last && last.label === label) last.length++
    else spans.push({ label, startIndex: index, length: 1 })
  })
  return spans
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/timeline/city-header.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline/city-header.ts src/lib/timeline/city-header.test.ts
git commit -m "feat: derive per-date city header spans from spot groups"
```

---

### Task 4: createBlock이 생성된 blockId를 반환

**Files:**
- Modify: `src/lib/plan-blocks/actions.ts`

**Interfaces:**
- Produces: `interface CreateBlockResult { error: string | null; blockId: number | null }`, `createBlock(input: BlockInput): Promise<CreateBlockResult>` — 기존 호출부(`block-dialog.tsx`, `today-view.tsx`)는 `result.error`만 읽으므로 하위 호환. Task 6의 생성 Undo(방금 만든 블록 삭제)가 blockId를 사용한다.

테스트: 서버 액션은 단위 테스트하지 않는 기존 관례. 타입체크·린트·기존 스위트로 확인.

- [ ] **Step 1: createBlock 수정** — 반환 타입과 insert를 다음으로 교체:

```ts
export interface CreateBlockResult {
  error: string | null
  blockId: number | null
}
```

`createBlock` 시그니처를 `Promise<CreateBlockResult>`로 바꾸고, 유효성 검사 실패 반환들을 `return { error: titleError, blockId: null }` 형태로 맞춘다. insert 부분:

```ts
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plan_blocks')
    .insert({
      trip_id: input.tripId,
      date: input.date,
      start_time: input.startTime,
      end_time: input.endTime,
      type: input.type,
      spot_id: input.spotId,
      title: input.title.trim(),
      memo: input.memo.trim() || null,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('createBlock failed:', error)
    return { error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', blockId: null }
  }
```

성공 반환은 `return { error: null, blockId: data.id }`. spot 상태 업데이트와 revalidatePath 두 줄은 그대로 유지.

- [ ] **Step 2: 검증**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run src/lib`
Expected: 에러 없음, 기존 테스트 PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/plan-blocks/actions.ts
git commit -m "feat: return created block id from createBlock for undo support"
```

---

### Task 5: TimelineView 전면 재작성 — 드래그 편집·힌트·도시 헤더·모바일 리스트

**Files:**
- Rewrite: `src/app/trips/[tripId]/plan/timeline-view.tsx`
- Modify: `src/app/trips/[tripId]/plan/plan-canvas.tsx` (TimelineView에 `groups` 전달)

**Interfaces:**
- Consumes: Task 1–3의 순수 함수 전부, `updateBlock`/`BlockInput`(기존), `useTripRealtime().markEdited`, engine의 `minutesToTime`/`timeToMinutes`, sonner `toast`
- Produces: `TimelineView({ tripId, startDate, endDate, blocks, spots, groups })` — groups prop 추가. `enumerateDates` export 유지(기존 테스트 참조). 데스크톱(md+)은 드래그 그리드, 모바일은 일 단위 리스트.

동작 명세:
- 빈 슬롯 **클릭**(4px 미만 이동): 기존처럼 그 지점 15분 스냅 시작 + 1시간 기본 다이얼로그.
- 빈 슬롯 **드래그**: 15분 스냅된 범위 미리보기(점선 박스) → 놓으면 그 범위로 생성 다이얼로그.
- 블록 본문 **드래그**: 같은 날 안에서 시간 이동(15분 스냅, 낙관적 렌더) → 서버 반영 + '일정을 이동했어요' Undo 토스트. 클릭(4px 미만)은 기존처럼 편집 다이얼로그.
- 블록 상/하단 가장자리(h-1.5, cursor-ns-resize) **드래그**: 길이 조절(최소 15분) → '블록 길이를 조절했어요' Undo 토스트.
- 이동/리사이즈 성공 시 `markEdited('plan_blocks', id)`; Undo도 updateBlock + markEdited.
- 서버 실패 시 낙관적 오버라이드 롤백 + `toast.error`.
- 연속 블록 이동시간 힌트: 다음 블록 시작 위치 우측에 `이동 ~N분` 칩; 그리드 아래에 "드래그로 생성·이동·길이 조절 (15분 단위) · 이동 시간은 직선거리 기반 추정" 안내 문구.
- 도시 헤더: 날짜 헤더 위 높이 6의 행 — 스팬 시작 컬럼에만 `밀라노 · 2일` 표시.
- 모바일(`md:hidden`): 날짜별 섹션 카드 리스트(탭→편집 다이얼로그), 섹션 헤더에 날짜·도시 라벨·`+ 일정 추가`(09:00–10:00 기본), 블록 사이 이동시간 힌트 행.

- [ ] **Step 1: timeline-view.tsx 전체를 다음 내용으로 교체**

```tsx
'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { PlanBlock, Spot, SpotGroup } from '@/types/database'
import { updateBlock, type BlockInput } from '@/lib/plan-blocks/actions'
import { useTripRealtime } from '@/lib/realtime/trip-realtime'
import { minutesToTime, timeToMinutes } from '@/lib/today/engine'
import {
  DAY_MINUTES,
  dragCreateRange,
  moveRange,
  pxToMinutes,
  resizeRange,
} from '@/lib/timeline/grid'
import { travelHints } from '@/lib/timeline/travel-hints'
import { cityHeaderSpans } from '@/lib/timeline/city-header'
import { BlockDialog, type BlockDraft } from './block-dialog'

const SLOT_MINUTES = 30
const SLOTS_PER_DAY = DAY_MINUTES / SLOT_MINUTES
const PX_PER_SLOT = 28
const PX_PER_MINUTE = PX_PER_SLOT / SLOT_MINUTES
const CLICK_THRESHOLD_PX = 4
const DEFAULT_CREATE_MINUTES = 60

const TYPE_LABELS: Record<string, string> = {
  spot: '스팟',
  transport: '이동',
  lodging: '숙소',
  memo: '메모',
}

const TYPE_COLORS: Record<string, string> = {
  spot: 'bg-blue-100 border-blue-300 text-blue-900',
  transport: 'bg-amber-100 border-amber-300 text-amber-900',
  lodging: 'bg-purple-100 border-purple-300 text-purple-900',
  memo: 'bg-gray-100 border-gray-300 text-gray-900',
}

const TYPE_BAR_COLORS: Record<string, string> = {
  spot: 'bg-blue-400',
  transport: 'bg-amber-400',
  lodging: 'bg-purple-400',
  memo: 'bg-gray-400',
}

export function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  // UTC로 파싱/증가시켜야 한다: 'T00:00:00'(타임존 없음)을 로컬 자정으로 파싱한
  // 뒤 toISOString()(UTC)으로 읽으면, UTC+ 타임존(한국 등)에서 모든 날짜가
  // 하루씩 앞으로 밀린다 — 마지막 날짜 컬럼이 통째로 사라지는 버그로 이어짐.
  const cursor = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

interface LaidOutBlock extends PlanBlock {
  column: number
  columnCount: number
}

// 그리디 컬럼 배정: 시작 시간순으로 정렬한 뒤, 각 블록을 "마지막 블록이 이미
// 끝난" 첫 번째 기존 컬럼에 넣고, 없으면 새 컬럼을 만든다. 겹치는 블록들은
// 서로 다른 컬럼에 들어가 나란히 배치된다.
function layoutDayBlocks(blocks: PlanBlock[]): LaidOutBlock[] {
  const sorted = [...blocks].sort((a, b) => a.start_time.localeCompare(b.start_time))
  const columns: PlanBlock[][] = []

  for (const block of sorted) {
    let placed = false
    for (const column of columns) {
      const last = column[column.length - 1]
      if (last.end_time <= block.start_time) {
        column.push(block)
        placed = true
        break
      }
    }
    if (!placed) columns.push([block])
  }

  const columnCount = columns.length || 1
  const result: LaidOutBlock[] = []
  columns.forEach((column, columnIndex) => {
    column.forEach((block) => {
      result.push({ ...block, column: columnIndex, columnCount })
    })
  })
  return result
}

type DragState =
  | { kind: 'create'; date: string; columnTop: number; anchorPx: number; currentPx: number }
  | { kind: 'move'; block: PlanBlock; startClientY: number; deltaPx: number }
  | { kind: 'resize'; block: PlanBlock; edge: 'top' | 'bottom'; startClientY: number; deltaPx: number }

function toDbTime(hhmm: string): string {
  return `${hhmm}:00`
}

function blockToInput(
  block: PlanBlock,
  startHHMM: string,
  endHHMM: string,
  tripStartDate: string,
  tripEndDate: string
): Omit<BlockInput, 'tripId'> {
  return {
    date: block.date,
    startTime: toDbTime(startHHMM),
    endTime: toDbTime(endHHMM),
    type: block.type,
    spotId: block.spot_id,
    title: block.title,
    memo: block.memo ?? '',
    tripStartDate,
    tripEndDate,
  }
}

export function TimelineView({
  tripId,
  startDate,
  endDate,
  blocks,
  spots,
  groups,
}: {
  tripId: number
  startDate: string
  endDate: string
  blocks: PlanBlock[]
  spots: Spot[]
  groups: SpotGroup[]
}) {
  const dates = enumerateDates(startDate, endDate)
  const spotById = new Map(spots.map((spot) => [spot.id, spot]))
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]))
  const dayHeight = SLOTS_PER_DAY * PX_PER_SLOT
  const { markEdited } = useTripRealtime()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<BlockDraft | null>(null)
  const [editingBlock, setEditingBlock] = useState<PlanBlock | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [pendingTimes, setPendingTimes] = useState<
    Record<number, { start: string; end: string }>
  >({})
  const [, startTransition] = useTransition()

  const dragRef = useRef<DragState | null>(null)
  const dragMovedRef = useRef(false)

  // 서버 revalidate로 새 blocks prop이 내려오면 낙관적 오버라이드를 걷어낸다 —
  // 이 시점의 서버 상태가 곧 최종(LWW)이므로 남겨두면 오히려 어긋난다.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPendingTimes({})
  }, [blocks])
  /* eslint-enable react-hooks/set-state-in-effect */

  const adjustedBlocks = blocks.map((block) => {
    const pending = pendingTimes[block.id]
    return pending ? { ...block, start_time: pending.start, end_time: pending.end } : block
  })

  const spans = cityHeaderSpans(dates, adjustedBlocks, spotById, groupNameById)
  const spanAt = (index: number) =>
    spans.find((span) => index >= span.startIndex && index < span.startIndex + span.length)

  const beginDrag = (state: DragState) => {
    dragRef.current = state
    dragMovedRef.current = false
    setDrag(state)
  }

  const openCreateDialog = (date: string, startMin: number, endMin: number) => {
    setDraft({
      tripId,
      date,
      startTime: minutesToTime(startMin),
      // input[type=time]은 24:00을 표현하지 못한다 — 자정까지 드래그한 경우
      // 23:59로 보여준다 (block-dialog의 편집 브랜치와 같은 처리).
      endTime: endMin >= DAY_MINUTES ? '23:59' : minutesToTime(endMin),
    })
    setEditingBlock(null)
    setDialogOpen(true)
  }

  const openEditDialog = (block: PlanBlock) => {
    setEditingBlock(block)
    setDraft(null)
    setDialogOpen(true)
  }

  const commitTimes = (block: PlanBlock, startMin: number, endMin: number, message: string) => {
    const start = minutesToTime(startMin)
    const end = minutesToTime(endMin)
    if (toDbTime(start) === block.start_time && toDbTime(end) === block.end_time) return

    const prevStart = block.start_time.slice(0, 5)
    const prevEnd = block.end_time.slice(0, 5)
    setPendingTimes((prev) => ({
      ...prev,
      [block.id]: { start: toDbTime(start), end: toDbTime(end) },
    }))

    startTransition(async () => {
      const result = await updateBlock(
        block.id,
        tripId,
        blockToInput(block, start, end, startDate, endDate)
      )
      if (result.error) {
        toast.error(result.error)
        setPendingTimes((prev) => {
          const next = { ...prev }
          delete next[block.id]
          return next
        })
        return
      }
      markEdited('plan_blocks', block.id)
      toast(message, {
        action: {
          label: '실행 취소',
          onClick: () => {
            startTransition(async () => {
              const undo = await updateBlock(
                block.id,
                tripId,
                blockToInput(block, prevStart, prevEnd, startDate, endDate)
              )
              if (undo.error) toast.error(undo.error)
              else markEdited('plan_blocks', block.id)
            })
          },
        },
      })
    })
  }

  // 드래그 중에는 window 레벨에서 pointermove/up을 받는다 — 포인터가 컬럼/블록
  // 밖으로 나가도 추적이 끊기지 않게 하기 위함. drag 상태가 있을 때만 부착.
  // (openCreateDialog 등 렌더 스코프 함수를 쓰지만, drag가 바뀔 때마다 이 effect가
  // 재실행되어 클로저가 갱신되므로 stale 값 문제가 없다.)
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!drag) return

    const onPointerMove = (event: PointerEvent) => {
      const current = dragRef.current
      if (!current) return
      let next: DragState
      if (current.kind === 'create') {
        const currentPx = event.clientY - current.columnTop
        if (Math.abs(currentPx - current.anchorPx) > CLICK_THRESHOLD_PX) {
          dragMovedRef.current = true
        }
        next = { ...current, currentPx }
      } else {
        const deltaPx = event.clientY - current.startClientY
        if (Math.abs(deltaPx) > CLICK_THRESHOLD_PX) dragMovedRef.current = true
        next = { ...current, deltaPx }
      }
      dragRef.current = next
      setDrag(next)
    }

    const onPointerUp = () => {
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!current) return

      if (current.kind === 'create') {
        if (dragMovedRef.current) {
          const range = dragCreateRange(current.anchorPx, current.currentPx, PX_PER_MINUTE)
          openCreateDialog(current.date, range.startMin, range.endMin)
        } else {
          const startMin = Math.min(
            pxToMinutes(current.anchorPx, PX_PER_MINUTE),
            DAY_MINUTES - DEFAULT_CREATE_MINUTES
          )
          openCreateDialog(current.date, startMin, startMin + DEFAULT_CREATE_MINUTES)
        }
        return
      }

      if (!dragMovedRef.current) {
        openEditDialog(current.block)
        return
      }

      const startMin = timeToMinutes(current.block.start_time)
      const endMin = timeToMinutes(current.block.end_time)
      if (current.kind === 'move') {
        const range = moveRange(startMin, endMin, current.deltaPx, PX_PER_MINUTE)
        commitTimes(current.block, range.startMin, range.endMin, '일정을 이동했어요')
      } else {
        const range = resizeRange(startMin, endMin, current.edge, current.deltaPx, PX_PER_MINUTE)
        commitTimes(current.block, range.startMin, range.endMin, '블록 길이를 조절했어요')
      }
    }

    const onPointerCancel = () => {
      dragRef.current = null
      setDrag(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [drag])
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <>
      {/* 데스크톱: 드래그 편집 그리드 */}
      <div className="hidden overflow-x-auto rounded-lg border md:flex">
        {dates.map((date, dateIndex) => {
          const rawDayBlocks = adjustedBlocks.filter((block) => block.date === date)
          const dayBlocks = layoutDayBlocks(rawDayBlocks)
          const hints = travelHints(rawDayBlocks, spotById)
          const span = spanAt(dateIndex)
          const cityHeader =
            span && span.label != null && dateIndex === span.startIndex
              ? `${span.label} · ${span.length}일`
              : ''

          return (
            <div key={date} className="w-56 shrink-0 border-r last:border-r-0">
              <div className="h-6 truncate border-b bg-muted/30 px-2 text-[11px] leading-6 text-muted-foreground">
                {cityHeader}
              </div>
              <div className="border-b bg-muted/50 p-2 text-center text-sm font-medium">{date}</div>
              <div
                className="relative cursor-pointer touch-none"
                style={{
                  height: dayHeight,
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${PX_PER_SLOT}px)`,
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  const anchorPx = event.clientY - rect.top
                  beginDrag({ kind: 'create', date, columnTop: rect.top, anchorPx, currentPx: anchorPx })
                }}
              >
                {dayBlocks.map((block) => {
                  let startMin = timeToMinutes(block.start_time)
                  let endMin = timeToMinutes(block.end_time)
                  // isDragTarget을 boolean 변수로 빼면 TS가 아래에서 drag를 좁히지
                  // 못하므로, 판별은 drag를 직접 검사하는 형태로 쓴다.
                  const isDragTarget =
                    drag != null && drag.kind !== 'create' && drag.block.id === block.id
                  if (drag && drag.kind === 'move' && drag.block.id === block.id && dragMovedRef.current) {
                    const range = moveRange(startMin, endMin, drag.deltaPx, PX_PER_MINUTE)
                    startMin = range.startMin
                    endMin = range.endMin
                  } else if (
                    drag &&
                    drag.kind === 'resize' &&
                    drag.block.id === block.id &&
                    dragMovedRef.current
                  ) {
                    const range = resizeRange(startMin, endMin, drag.edge, drag.deltaPx, PX_PER_MINUTE)
                    startMin = range.startMin
                    endMin = range.endMin
                  }

                  const widthPercent = 100 / block.columnCount
                  const spot = block.spot_id ? spotById.get(block.spot_id) : null

                  return (
                    <div
                      key={block.id}
                      className={`absolute overflow-hidden rounded border p-1 text-xs ${TYPE_COLORS[block.type]} ${
                        isDragTarget ? 'z-10 opacity-80 shadow-md' : ''
                      }`}
                      style={{
                        top: startMin * PX_PER_MINUTE,
                        height: (endMin - startMin) * PX_PER_MINUTE,
                        left: `${block.column * widthPercent}%`,
                        width: `${widthPercent}%`,
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        if (event.button !== 0) return
                        beginDrag({ kind: 'move', block, startClientY: event.clientY, deltaPx: 0 })
                      }}
                    >
                      <div
                        className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          if (event.button !== 0) return
                          beginDrag({
                            kind: 'resize',
                            block,
                            edge: 'top',
                            startClientY: event.clientY,
                            deltaPx: 0,
                          })
                        }}
                      />
                      <div className="font-medium">{block.title}</div>
                      <div className="text-[10px] opacity-70">
                        {minutesToTime(startMin)}–{minutesToTime(endMin)} · {TYPE_LABELS[block.type]}
                      </div>
                      {spot && <div className="text-[10px] opacity-70">{spot.name}</div>}
                      <div
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          if (event.button !== 0) return
                          beginDrag({
                            kind: 'resize',
                            block,
                            edge: 'bottom',
                            startClientY: event.clientY,
                            deltaPx: 0,
                          })
                        }}
                      />
                    </div>
                  )
                })}

                {hints.map((hint) => (
                  <div
                    key={`${hint.fromBlockId}-${hint.toBlockId}`}
                    className="pointer-events-none absolute right-1 z-10 -translate-y-full rounded bg-background/90 px-1 text-[10px] text-muted-foreground shadow-sm"
                    style={{ top: hint.boundaryMin * PX_PER_MINUTE }}
                  >
                    이동 ~{hint.walkMin}분
                  </div>
                ))}

                {drag?.kind === 'create' && drag.date === date && dragMovedRef.current && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 rounded border-2 border-dashed border-blue-400/70 bg-blue-100/40"
                    style={{
                      top: dragCreateRange(drag.anchorPx, drag.currentPx, PX_PER_MINUTE).startMin * PX_PER_MINUTE,
                      height:
                        (dragCreateRange(drag.anchorPx, drag.currentPx, PX_PER_MINUTE).endMin -
                          dragCreateRange(drag.anchorPx, drag.currentPx, PX_PER_MINUTE).startMin) *
                        PX_PER_MINUTE,
                    }}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-1 hidden text-[11px] text-muted-foreground md:block">
        드래그로 생성·이동·길이 조절 (15분 단위) · 이동 시간은 직선거리 기반 추정
      </p>

      {/* 모바일: 일 단위 세로 리스트 (PRD F4) */}
      <div className="space-y-4 md:hidden">
        {dates.map((date, dateIndex) => {
          const dayBlocks = adjustedBlocks
            .filter((block) => block.date === date)
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
          const hints = travelHints(dayBlocks, spotById)
          const hintByFromId = new Map(hints.map((hint) => [hint.fromBlockId, hint]))
          const cityLabel = spanAt(dateIndex)?.label

          return (
            <section key={date} className="rounded-lg border">
              <header className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
                <span className="text-sm font-medium">
                  {date}
                  {cityLabel ? ` · ${cityLabel}` : ''}
                </span>
                <button
                  type="button"
                  className="min-h-11 text-xs text-muted-foreground"
                  onClick={() => openCreateDialog(date, 9 * 60, 10 * 60)}
                >
                  + 일정 추가
                </button>
              </header>
              {dayBlocks.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">일정 없음</p>
              ) : (
                <ul>
                  {dayBlocks.map((block) => {
                    const spot = block.spot_id ? spotById.get(block.spot_id) : null
                    const hint = hintByFromId.get(block.id)
                    return (
                      <li key={block.id} className="border-b last:border-b-0">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left"
                          onClick={() => openEditDialog(block)}
                        >
                          <span className={`h-8 w-1 shrink-0 rounded ${TYPE_BAR_COLORS[block.type]}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{block.title}</span>
                            <span className="block text-xs text-muted-foreground">
                              {block.start_time.slice(0, 5)}–{block.end_time.slice(0, 5)} ·{' '}
                              {TYPE_LABELS[block.type]}
                              {spot ? ` · ${spot.name}` : ''}
                            </span>
                          </span>
                        </button>
                        {hint && (
                          <p className="px-3 pb-2 text-[11px] text-muted-foreground">
                            ↓ 이동 ~{hint.walkMin}분 (직선거리 기준)
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      <BlockDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        draft={draft}
        editingBlock={editingBlock}
        spots={spots}
        tripStartDate={startDate}
        tripEndDate={endDate}
      />
    </>
  )
}
```

- [ ] **Step 2: plan-canvas.tsx의 TimelineView 호출에 groups 전달** — 기존:

```tsx
        <TimelineView tripId={tripId} startDate={startDate} endDate={endDate} blocks={blocks} spots={spots} />
```

을 다음으로 교체:

```tsx
        <TimelineView
          tripId={tripId}
          startDate={startDate}
          endDate={endDate}
          blocks={blocks}
          spots={spots}
          groups={groups}
        />
```

- [ ] **Step 3: 검증**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run && pnpm build`
Expected: 전부 통과 (timeline-view.test.ts의 enumerateDates 테스트 포함)

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/\[tripId\]/plan/timeline-view.tsx src/app/trips/\[tripId\]/plan/plan-canvas.tsx
git commit -m "feat: calendar-style timeline editing with drag create/move/resize, hints, city header, mobile list"
```

---

### Task 6: 생성·삭제 Undo 토스트 (BlockDialog)

**Files:**
- Modify: `src/app/trips/[tripId]/plan/block-dialog.tsx`

**Interfaces:**
- Consumes: Task 4의 `CreateBlockResult`(blockId), 기존 `deleteBlock`/`createBlock`, sonner `toast`, `useTripRealtime().markEdited`(이미 import되어 있음)
- Produces: 생성 성공 → '일정을 추가했어요' 토스트(실행 취소 = 방금 만든 블록 삭제). 삭제 성공 → '일정을 삭제했어요' 토스트(실행 취소 = 같은 내용으로 재생성; id는 새로 발급되며 스팟 status는 createBlock이 다시 planned로 만든다).

- [ ] **Step 1: import에 toast 추가**

```tsx
import { toast } from 'sonner'
```

- [ ] **Step 2: submit의 성공 분기 수정** — 기존:

```tsx
      if (result.error) {
        setError(result.error)
      } else {
        if (editingBlock) markEdited('plan_blocks', editingBlock.id)
        onOpenChange(false)
      }
```

을 다음으로 교체 (create 경로에서 `result`는 `CreateBlockResult`이므로 분기를 나눈다):

```tsx
      if (editingBlock) {
        const result = await updateBlock(editingBlock.id, tripId, input)
        if (result.error) {
          setError(result.error)
          return
        }
        markEdited('plan_blocks', editingBlock.id)
        onOpenChange(false)
        return
      }

      const result = await createBlock(input)
      if (result.error) {
        setError(result.error)
        return
      }
      onOpenChange(false)
      const createdId = result.blockId
      if (createdId != null) {
        toast('일정을 추가했어요', {
          action: {
            label: '실행 취소',
            onClick: () => {
              void deleteBlock(createdId, tripId)
            },
          },
        })
      }
```

이에 맞춰 submit 상단의 기존 `const result = editingBlock ? await updateBlock(...) : await createBlock(input)` 3항 호출은 삭제한다(위 코드가 대체). `input` 구성은 그대로 둔다.

- [ ] **Step 3: remove의 성공 분기 수정** — 기존:

```tsx
  const remove = () => {
    if (!editingBlock) return
    startTransition(async () => {
      const result = await deleteBlock(editingBlock.id, editingBlock.trip_id)
      if (result.error) {
        setError(result.error)
      } else {
        onOpenChange(false)
      }
    })
  }
```

을 다음으로 교체:

```tsx
  const remove = () => {
    if (!editingBlock) return
    const deleted = editingBlock
    startTransition(async () => {
      const result = await deleteBlock(deleted.id, deleted.trip_id)
      if (result.error) {
        setError(result.error)
        return
      }
      onOpenChange(false)
      toast('일정을 삭제했어요', {
        action: {
          label: '실행 취소',
          onClick: () => {
            // 재생성이므로 id는 새로 발급된다. 스팟 연결·시간·메모는 그대로 복원.
            void createBlock({
              tripId: deleted.trip_id,
              date: deleted.date,
              startTime: deleted.start_time,
              endTime: deleted.end_time,
              type: deleted.type,
              spotId: deleted.spot_id,
              title: deleted.title,
              memo: deleted.memo ?? '',
              tripStartDate,
              tripEndDate,
            })
          },
        },
      })
    })
  }
```

- [ ] **Step 4: 검증**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run src/lib src/app`
Expected: 에러 없음, 테스트 PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/\[tripId\]/plan/block-dialog.tsx
git commit -m "feat: undo toasts for block create and delete"
```

---

### Task 7: 플랜 페이지 모바일 스택 + dnd-kit 제거

**Files:**
- Modify: `src/app/trips/[tripId]/plan/page.tsx`
- Modify: `package.json` (+ pnpm-lock.yaml)

- [ ] **Step 1: 플랜 페이지 레이아웃을 모바일 우선 스택으로** — `page.tsx`의 렌더 부분 기존:

```tsx
      <div className="flex gap-6">
        <aside className="w-72 shrink-0">
```

을 다음으로 교체:

```tsx
      <div className="flex flex-col gap-6 md:flex-row">
        <aside className="w-full shrink-0 md:w-72">
```

- [ ] **Step 2: 미사용 dnd-kit 의존성 제거**

Run: `pnpm remove @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
확인: `grep -r "@dnd-kit" src/` → 결과 없음 (원래 미사용이었음)

- [ ] **Step 3: 검증**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run && pnpm build`
Expected: 전부 통과

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/\[tripId\]/plan/page.tsx package.json pnpm-lock.yaml
git commit -m "chore: stack plan layout on mobile and drop unused dnd-kit deps"
```

---

### Task 8: 최종 검증

**Files:** (검증만)

- [ ] **Step 1: 전체 자동 검증**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run && pnpm build`
Expected: 전부 통과 (RLS 테스트는 로컬 Supabase 필요)

- [ ] **Step 2: 수동 검증 (pnpm dev)**

1. 데스크톱 타임라인: 빈 슬롯 클릭 → 15분 스냅 시작 + 1시간 다이얼로그 / 빈 슬롯 드래그 → 점선 미리보기 + 드래그 범위 다이얼로그.
2. 블록 드래그 이동(스냅백 없이 즉시 이동) → '일정을 이동했어요' 토스트 → 실행 취소로 원위치.
3. 상/하단 가장자리 리사이즈(최소 15분) → '블록 길이를 조절했어요' 토스트 + Undo.
4. 블록 클릭(이동 없이) → 편집 다이얼로그 그대로.
5. 생성/삭제 각각 Undo 토스트 동작.
6. 좌표 있는 스팟 블록 2개 연속 배치 → 사이에 '이동 ~N분' 칩, 그리드 아래 직선거리 안내 문구.
7. 그룹 지정된 스팟 블록이 있는 날짜들 → 상단 도시 헤더 `밀라노 · 2일` 스팬 표시.
8. 브라우저 폭 축소(<768px) → 일 단위 리스트 뷰 + 장소 패널 스택, 탭으로 편집, '+ 일정 추가' 동작.
9. 두 계정 동시 접속 시 드래그 이동이 상대 화면에 수 초 내 반영(F7 회귀 확인).

- [ ] **Step 3: 결과 요약 보고**

## PRD 대비 의도적 스코프 결정

- **인라인 팝오버 편집**: 모달(BlockDialog) 유지 — "전체 화면 이동 없이 즉시 편집·삭제"라는 목적은 충족하며, 팝오버 폼팩터 전환은 별도 후속으로 남긴다(기존 M2 플랜에서도 기록된 치환).
- **크로스데이 드래그 이동**: PRD가 명시적으로 MVP 제외(다이얼로그의 날짜 변경으로 대체).
- **도시 헤더의 데이터 소스**: 날짜→도시 매핑 테이블이 없으므로 그날 배치된 스팟 블록들의 spot_group 최빈값으로 추정한다. lodgings 도입 시 숙소 기반으로 교체 가능.
- **dnd-kit 제거**: 설치만 되어 있고 미사용. 포인터 이벤트 구현이 시간 그리드에 더 적합하며 순수 함수로 테스트 가능.
