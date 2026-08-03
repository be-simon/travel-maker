import { describe, it, expect } from 'vitest'
import { filterBookmarks, isBookmarkImported } from './filter'
import type { Bookmark } from '@/types/database'

function bookmark(overrides: Partial<Bookmark>): Bookmark {
  return {
    id: 1,
    owner_id: 'u1',
    name: 'Duomo',
    category: 'sight',
    country: 'Italia',
    city: 'Milano',
    place_id: 'p1',
    lat: null,
    lng: null,
    address: 'Piazza del Duomo',
    memo: null,
    source: 'manual',
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

const NO_FILTER = { query: '', country: null, city: null, category: null }

describe('filterBookmarks', () => {
  it('matches query against name, address, memo (case-insensitive)', () => {
    const items = [
      bookmark({ id: 1, name: 'Duomo' }),
      bookmark({ id: 2, name: 'Cafe', address: 'Via Roma 1' }),
      bookmark({ id: 3, name: 'Shop', address: null, memo: 'buy leather' }),
    ]
    expect(filterBookmarks(items, { ...NO_FILTER, query: 'duo' }).map((b) => b.id)).toEqual([1])
    expect(filterBookmarks(items, { ...NO_FILTER, query: 'ROMA' }).map((b) => b.id)).toEqual([2])
    expect(filterBookmarks(items, { ...NO_FILTER, query: 'leather' }).map((b) => b.id)).toEqual([3])
    expect(filterBookmarks(items, { ...NO_FILTER, query: 'nothing' })).toEqual([])
  })

  it('applies country/city/category chips together with query', () => {
    const items = [
      bookmark({ id: 1, country: 'Italia', city: 'Milano', category: 'sight' }),
      bookmark({ id: 2, country: 'Italia', city: 'Firenze', category: 'restaurant' }),
      bookmark({ id: 3, country: 'Japan', city: 'Tokyo', category: 'sight' }),
    ]
    expect(filterBookmarks(items, { ...NO_FILTER, country: 'Italia' }).map((b) => b.id)).toEqual([1, 2])
    expect(filterBookmarks(items, { ...NO_FILTER, city: 'Firenze' }).map((b) => b.id)).toEqual([2])
    expect(filterBookmarks(items, { ...NO_FILTER, category: 'sight' }).map((b) => b.id)).toEqual([1, 3])
    expect(
      filterBookmarks(items, { query: 'duomo', country: 'Japan', city: null, category: null }).map((b) => b.id)
    ).toEqual([3])
  })
})

describe('isBookmarkImported', () => {
  it('matches by bookmark_id provenance', () => {
    expect(isBookmarkImported(bookmark({ id: 7 }), [{ bookmark_id: 7, place_id: null }])).toBe(true)
  })

  it('matches by place_id when both sides have one', () => {
    expect(isBookmarkImported(bookmark({ id: 7, place_id: 'px' }), [{ bookmark_id: null, place_id: 'px' }])).toBe(true)
  })

  it('does not match a place_id-less bookmark against place_id-less spots', () => {
    expect(isBookmarkImported(bookmark({ id: 7, place_id: null }), [{ bookmark_id: null, place_id: null }])).toBe(false)
  })

  it('returns false when nothing matches', () => {
    expect(isBookmarkImported(bookmark({ id: 7, place_id: 'px' }), [{ bookmark_id: 8, place_id: 'py' }])).toBe(false)
  })
})
