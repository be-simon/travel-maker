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
