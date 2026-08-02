import { describe, it, expect } from 'vitest'
import { spotIdsScheduledOnDate, buildRouteForDate } from './map-view'
import type { PlanBlock, Spot } from '@/types/database'

// PlanBlock has many required fields we don't care about for these tests —
// this helper fills in placeholder values so each test case only needs to
// specify what's actually relevant (date/type/spot_id/start_time).
function block(overrides: Partial<PlanBlock> & { id: number }): PlanBlock {
  return {
    trip_id: 1,
    date: '2026-06-01',
    type: 'spot',
    spot_id: null,
    title: '',
    start_time: '09:00:00',
    end_time: '10:00:00',
    memo: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// Same idea for Spot, restricted to spots with non-null lat/lng (buildRouteForDate
// only ever receives already-located spots — see map-view.tsx's `located` filter).
function locatedSpot(overrides: Partial<Spot> & { id: number; lat: number; lng: number }): Spot {
  return {
    trip_id: 1,
    group_id: null,
    bookmark_id: null,
    name: `spot-${overrides.id}`,
    category: 'sight',
    place_id: null,
    address: null,
    memo: null,
    priority: false,
    est_cost: null,
    link: null,
    status: 'planned',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('spotIdsScheduledOnDate', () => {
  it('only includes spot-type blocks on the exact date with a linked spot', () => {
    const blocks = [
      block({ id: 1, date: '2026-06-01', type: 'spot', spot_id: 1 }),
      block({ id: 2, date: '2026-06-01', type: 'transport', spot_id: null }),
      block({ id: 3, date: '2026-06-02', type: 'spot', spot_id: 2 }),
      block({ id: 4, date: '2026-06-01', type: 'spot', spot_id: null }),
    ]
    expect(spotIdsScheduledOnDate(blocks, '2026-06-01')).toEqual(new Set([1]))
  })

  it('returns an empty set for a date with no matching blocks', () => {
    expect(spotIdsScheduledOnDate([], '2026-06-01')).toEqual(new Set())
  })
})

describe('buildRouteForDate', () => {
  const spots = [
    locatedSpot({ id: 1, lat: 37.1, lng: 127.1, name: 'A' }),
    locatedSpot({ id: 2, lat: 37.2, lng: 127.2, name: 'B' }),
    locatedSpot({ id: 3, lat: 37.3, lng: 127.3, name: 'C' }),
  ]

  it('sorts matching blocks by start_time into sequence order', () => {
    const blocks = [
      block({ id: 1, date: '2026-06-01', type: 'spot', spot_id: 2, start_time: '11:00:00' }),
      block({ id: 2, date: '2026-06-01', type: 'spot', spot_id: 1, start_time: '09:00:00' }),
      block({ id: 3, date: '2026-06-01', type: 'spot', spot_id: 3, start_time: '13:00:00' }),
    ]
    const route = buildRouteForDate(blocks, spots as (Spot & { lat: number; lng: number })[], '2026-06-01')
    expect(route.map((stop) => ({ id: stop.spot.id, sequence: stop.sequence }))).toEqual([
      { id: 1, sequence: 1 },
      { id: 2, sequence: 2 },
      { id: 3, sequence: 3 },
    ])
  })

  it('skips a block whose spot_id does not resolve to any spot in the provided list', () => {
    const blocks = [
      block({ id: 1, date: '2026-06-01', type: 'spot', spot_id: 1, start_time: '09:00:00' }),
      // spot_id 999 isn't in `spots` — e.g. it was filtered out or deleted.
      block({ id: 2, date: '2026-06-01', type: 'spot', spot_id: 999, start_time: '10:00:00' }),
      block({ id: 3, date: '2026-06-01', type: 'spot', spot_id: 2, start_time: '11:00:00' }),
    ]
    const route = buildRouteForDate(blocks, spots as (Spot & { lat: number; lng: number })[], '2026-06-01')
    expect(route.map((stop) => stop.spot.id)).toEqual([1, 2])
    expect(route.map((stop) => stop.sequence)).toEqual([1, 2])
  })
})
