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
