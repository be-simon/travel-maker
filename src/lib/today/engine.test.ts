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
