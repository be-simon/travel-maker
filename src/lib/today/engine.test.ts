import { describe, expect, it } from 'vitest'
import type { PlanBlock, Spot } from '@/types/database'
import {
  directionsUrl,
  findCurrentBlock,
  findInsertSlot,
  findNextBlock,
  haversineKm,
  localDateString,
  minutesToTime,
  recommendSpots,
  resolveAnchor,
  shiftTimes,
  timeToMinutes,
  walkMinutes,
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
