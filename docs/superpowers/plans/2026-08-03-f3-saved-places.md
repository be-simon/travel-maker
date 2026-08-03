# F3 코어 — 저장한 장소 라이브러리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계정 단위 "저장한 장소" 라이브러리(/places)와 플랜 화면의 "저장한 장소에서 담기"를 구현한다.

**Architecture:** 기존 lib 모듈 3파일 패턴(validation/queries/actions)으로 `src/lib/bookmarks/`를 추가하고, AddSpotDialog의 Places 검색을 `PlaceSearchInput` 공용 컴포넌트로 추출해 북마크 다이얼로그와 공유한다. 국가/도시 태깅은 Places addressComponents에서 추출(추가 API 호출 없음). 중복은 unique partial index + 23505 처리.

**Tech Stack:** Next.js App Router, Supabase (RLS·server actions), @vis.gl/react-google-maps Places, vitest.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-03-f3-saved-places-design.md`
- 서버 액션은 기존 `ActionResult { error: string | null }` 패턴, 실패 시 `console.error` + 일반 안내 메시지.
- 사용자 노출 문구는 한국어, 기존 톤(예: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.").
- RLS 테스트(`src/test/rls-*.test.ts`)는 `.env.test.local`의 로컬 Supabase가 필요하다. 이 환경에는 없어 "supabaseUrl is required"로 실패하는 것이 **기존 베이스라인**(rls-trips 4건)이다. 검증 게이트는 "단위 테스트 전체 통과 + RLS 실패는 env 부재 사유만"이다.
- 각 태스크 완료 시 커밋. 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: 마이그레이션 — place_id unique partial index + bookmarks RLS 테스트

**Files:**
- Create: `supabase/migrations/20260803000000_bookmarks_place_unique.sql`
- Create: `src/test/rls-bookmarks.test.ts`

**Interfaces:**
- Produces: bookmarks (owner_id, place_id) unique 제약 — Task 2의 createBookmark가 23505로 감지.

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- F3 중복 감지: 같은 계정에 같은 place_id 북마크를 두 번 저장할 수 없게 DB 레벨에서
-- 차단한다 (PRD §4 F3 "중복이면 저장 대신 기존 항목으로 안내"). place_id가 없는
-- 수동 입력은 제약을 받지 않는다.
drop index if exists public.bookmarks_owner_place_idx;
create unique index bookmarks_owner_place_uniq
  on public.bookmarks (owner_id, place_id)
  where place_id is not null;
```

- [ ] **Step 2: RLS·unique 테스트 작성** (`src/test/rls-bookmarks.test.ts`)

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { createTestUser, signInAsClient, deleteTestUser } from './supabase-test-helpers'

describe('bookmarks RLS', () => {
  const createdUserIds: string[] = []

  afterAll(async () => {
    await Promise.all(createdUserIds.map(deleteTestUser))
  })

  it('owner can create and list bookmarks; a stranger cannot see them or forge owner_id', async () => {
    const owner = await createTestUser(`bm-owner-${Date.now()}@example.com`)
    const stranger = await createTestUser(`bm-stranger-${Date.now()}@example.com`)
    createdUserIds.push(owner.user.id, stranger.user.id)

    const ownerClient = await signInAsClient(owner.user.email!, owner.password)
    const strangerClient = await signInAsClient(stranger.user.email!, stranger.password)

    const { data: bookmark, error: insertError } = await ownerClient
      .from('bookmarks')
      .insert({ owner_id: owner.user.id, name: 'Duomo', category: 'sight', place_id: `p-${Date.now()}` })
      .select()
      .single()
    expect(insertError).toBeNull()

    const { data: strangerView } = await strangerClient
      .from('bookmarks')
      .select()
      .eq('id', bookmark!.id)
    expect(strangerView).toEqual([])

    const { error: forgeError } = await strangerClient
      .from('bookmarks')
      .insert({ owner_id: owner.user.id, name: 'Forged', category: 'etc' })
    expect(forgeError).not.toBeNull()
  })

  it('same owner cannot save the same place_id twice; another owner can', async () => {
    const a = await createTestUser(`bm-a-${Date.now()}@example.com`)
    const b = await createTestUser(`bm-b-${Date.now()}@example.com`)
    createdUserIds.push(a.user.id, b.user.id)

    const aClient = await signInAsClient(a.user.email!, a.password)
    const bClient = await signInAsClient(b.user.email!, b.password)
    const placeId = `dup-${Date.now()}`

    const { error: first } = await aClient
      .from('bookmarks')
      .insert({ owner_id: a.user.id, name: 'One', category: 'etc', place_id: placeId })
    expect(first).toBeNull()

    const { error: dup } = await aClient
      .from('bookmarks')
      .insert({ owner_id: a.user.id, name: 'Two', category: 'etc', place_id: placeId })
    expect(dup?.code).toBe('23505')

    const { error: otherOwner } = await bClient
      .from('bookmarks')
      .insert({ owner_id: b.user.id, name: 'Mine', category: 'etc', place_id: placeId })
    expect(otherOwner).toBeNull()
  })
})
```

- [ ] **Step 3: 테스트 실행** — `pnpm test 2>&1 | tail -5`. 이 환경에서는 rls-bookmarks 2건이 "supabaseUrl is required"로 실패(기존 rls-trips와 동일 사유)해야 하고, 그 외 실패가 없어야 한다.

- [ ] **Step 4: Commit** — `feat: enforce per-account place_id uniqueness on bookmarks`

---

### Task 2: `src/lib/bookmarks/` — validation·queries·actions

**Files:**
- Create: `src/lib/bookmarks/validation.ts`, `src/lib/bookmarks/validation.test.ts`
- Create: `src/lib/bookmarks/queries.ts`
- Create: `src/lib/bookmarks/actions.ts`

**Interfaces:**
- Produces:
  - `validateBookmarkName(name: string): string | null`
  - `listMyBookmarks(): Promise<Bookmark[]>` (생성일 역순)
  - `createBookmark(input: { name: string; category: SpotCategory; country: string | null; city: string | null; placeId: string | null; lat: number | null; lng: number | null; address: string | null; memo: string }): Promise<ActionResult>`
  - `updateBookmark(id: number, input: { name: string; category: SpotCategory; country: string | null; city: string | null; memo: string }): Promise<ActionResult>`
  - `deleteBookmark(id: number): Promise<ActionResult>`
  - `importBookmarks(tripId: number, bookmarkIds: number[]): Promise<ActionResult>`

- [ ] **Step 1: 실패하는 validation 테스트 작성** (`validation.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { validateBookmarkName } from './validation'

describe('validateBookmarkName', () => {
  it('rejects empty and whitespace-only names', () => {
    expect(validateBookmarkName('')).not.toBeNull()
    expect(validateBookmarkName('   ')).not.toBeNull()
  })

  it('accepts a normal name', () => {
    expect(validateBookmarkName('두오모')).toBeNull()
  })
})
```

- [ ] **Step 2: 실행해 실패 확인** — `pnpm vitest run src/lib/bookmarks/validation.test.ts` → FAIL (module not found)

- [ ] **Step 3: validation.ts 구현**

```ts
export function validateBookmarkName(name: string): string | null {
  if (!name.trim()) return '장소 이름을 입력해 주세요.'
  return null
}
```

- [ ] **Step 4: 테스트 통과 확인**

- [ ] **Step 5: queries.ts 구현**

```ts
import { createClient } from '@/lib/supabase/server'
import type { Bookmark } from '@/types/database'

// RLS(bookmarks_all)가 소유자 격리를 보장하므로 명시적 owner 필터는 두지 않는다
// (spots/trips 쿼리와 동일한 패턴).
export async function listMyBookmarks(): Promise<Bookmark[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('bookmarks')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}
```

- [ ] **Step 6: actions.ts 구현** — `'use server'`, `ActionResult` 패턴. 핵심 코드:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { validateBookmarkName } from './validation'
import type { SpotCategory } from '@/types/database'

export interface ActionResult {
  error: string | null
}

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'

export async function createBookmark(input: {
  name: string
  category: SpotCategory
  country: string | null
  city: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  address: string | null
  memo: string
}): Promise<ActionResult> {
  const nameError = validateBookmarkName(input.name)
  if (nameError) return { error: nameError }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase.from('bookmarks').insert({
    owner_id: userData.user.id,
    name: input.name.trim(),
    category: input.category,
    country: input.country?.trim() || null,
    city: input.city?.trim() || null,
    place_id: input.placeId,
    lat: input.lat,
    lng: input.lng,
    address: input.address,
    memo: input.memo.trim() || null,
    source: 'manual',
  })

  if (error) {
    if (error.code === '23505') return { error: '이미 저장한 장소예요.' }
    console.error('createBookmark failed:', error)
    return { error: GENERIC_ERROR }
  }

  revalidatePath('/places')
  return { error: null }
}

export async function updateBookmark(
  id: number,
  input: {
    name: string
    category: SpotCategory
    country: string | null
    city: string | null
    memo: string
  }
): Promise<ActionResult> {
  const nameError = validateBookmarkName(input.name)
  if (nameError) return { error: nameError }

  const supabase = await createClient()
  const { error } = await supabase
    .from('bookmarks')
    .update({
      name: input.name.trim(),
      category: input.category,
      country: input.country?.trim() || null,
      city: input.city?.trim() || null,
      memo: input.memo.trim() || null,
    })
    .eq('id', id)

  if (error) {
    console.error('updateBookmark failed:', error)
    return { error: GENERIC_ERROR }
  }

  revalidatePath('/places')
  return { error: null }
}

export async function deleteBookmark(id: number): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('bookmarks').delete().eq('id', id)

  if (error) {
    console.error('deleteBookmark failed:', error)
    return { error: GENERIC_ERROR }
  }

  revalidatePath('/places')
  return { error: null }
}

// 북마크 → 여행 장소(스팟) 복사. RLS가 본인 북마크만 조회를 허용하므로 소유
// 검증은 select가 겸한다. 복사본 원칙(PRD §4 F3): 이후 스팟 편집은 원본과 무관.
export async function importBookmarks(tripId: number, bookmarkIds: number[]): Promise<ActionResult> {
  if (bookmarkIds.length === 0) return { error: '담을 장소를 선택해 주세요.' }

  const supabase = await createClient()
  const { data: bookmarks, error: fetchError } = await supabase
    .from('bookmarks')
    .select('*')
    .in('id', bookmarkIds)

  if (fetchError || !bookmarks || bookmarks.length === 0) {
    console.error('importBookmarks (fetch) failed:', fetchError)
    return { error: GENERIC_ERROR }
  }

  const { error } = await supabase.from('spots').insert(
    bookmarks.map((bookmark) => ({
      trip_id: tripId,
      group_id: null,
      bookmark_id: bookmark.id,
      name: bookmark.name,
      category: bookmark.category,
      place_id: bookmark.place_id,
      lat: bookmark.lat,
      lng: bookmark.lng,
      address: bookmark.address,
      memo: bookmark.memo,
      status: 'candidate',
    }))
  )

  if (error) {
    console.error('importBookmarks failed:', error)
    return { error: GENERIC_ERROR }
  }

  revalidatePath(`/trips/${tripId}/plan`)
  return { error: null }
}
```

- [ ] **Step 7: 전체 테스트·린트 실행** — `pnpm test`(베이스라인 유지), `pnpm lint`

- [ ] **Step 8: Commit** — `feat: add bookmarks lib module (validation, queries, actions)`

---

### Task 3: 공용 헬퍼 — extractCountryCity, filterBookmarks, isBookmarkImported, 카테고리 상수

**Files:**
- Create: `src/lib/places/address.ts`, `src/lib/places/address.test.ts`
- Create: `src/lib/bookmarks/filter.ts`, `src/lib/bookmarks/filter.test.ts`
- Create: `src/lib/spot-categories.ts`
- Modify: `src/app/trips/[tripId]/plan/add-spot-dialog.tsx` (CATEGORY_OPTIONS를 import로 교체)
- Modify: `src/app/trips/[tripId]/plan/spot-panel.tsx` (CATEGORY_LABELS를 import로 교체)

**Interfaces:**
- Produces:
  - `extractCountryCity(components: AddressComponentLike[] | null | undefined): { country: string | null; city: string | null }`
  - `AddressComponentLike { longText: string | null; types: string[] }`
  - `filterBookmarks(bookmarks: Bookmark[], filter: { query: string; country: string | null; city: string | null; category: string | null }): Bookmark[]`
  - `isBookmarkImported(bookmark: Bookmark, spots: Pick<Spot, 'bookmark_id' | 'place_id'>[]): boolean`
  - `CATEGORY_OPTIONS: { value: SpotCategory; label: string }[]`, `CATEGORY_LABELS: Record<SpotCategory, string>`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/places/address.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractCountryCity } from './address'

describe('extractCountryCity', () => {
  it('extracts country and locality', () => {
    expect(
      extractCountryCity([
        { longText: 'Milano', types: ['locality', 'political'] },
        { longText: 'Lombardia', types: ['administrative_area_level_1', 'political'] },
        { longText: 'Italia', types: ['country', 'political'] },
      ])
    ).toEqual({ country: 'Italia', city: 'Milano' })
  })

  it('falls back to administrative_area_level_1 when locality is missing', () => {
    expect(
      extractCountryCity([
        { longText: 'Tuscany', types: ['administrative_area_level_1'] },
        { longText: 'Italy', types: ['country'] },
      ])
    ).toEqual({ country: 'Italy', city: 'Tuscany' })
  })

  it('returns nulls for empty or missing components', () => {
    expect(extractCountryCity([])).toEqual({ country: null, city: null })
    expect(extractCountryCity(null)).toEqual({ country: null, city: null })
    expect(extractCountryCity(undefined)).toEqual({ country: null, city: null })
  })
})
```

`src/lib/bookmarks/filter.test.ts`:

```ts
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
```

- [ ] **Step 2: 실행해 실패 확인** — 두 테스트 파일 모두 module not found로 FAIL

- [ ] **Step 3: 구현**

`src/lib/places/address.ts`:

```ts
// Places API(New)의 addressComponents에서 국가/도시를 추출한다. PRD는 "좌표 기반
// 역지오코딩"을 명시했지만, Place Details 응답에 이미 포함된 컴포넌트를 쓰면 추가
// API 호출 없이 같은 결과를 얻는다 (spec §3).
export interface AddressComponentLike {
  longText: string | null
  types: string[]
}

export function extractCountryCity(
  components: AddressComponentLike[] | null | undefined
): { country: string | null; city: string | null } {
  if (!components) return { country: null, city: null }
  const find = (type: string) =>
    components.find((component) => component.types.includes(type))?.longText ?? null
  return {
    country: find('country'),
    city: find('locality') ?? find('administrative_area_level_1'),
  }
}
```

`src/lib/bookmarks/filter.ts`:

```ts
import type { Bookmark, Spot } from '@/types/database'

export interface BookmarkFilter {
  query: string
  country: string | null
  city: string | null
  category: string | null
}

export function filterBookmarks(bookmarks: Bookmark[], filter: BookmarkFilter): Bookmark[] {
  const query = filter.query.trim().toLowerCase()
  return bookmarks.filter((bookmark) => {
    if (filter.country && bookmark.country !== filter.country) return false
    if (filter.city && bookmark.city !== filter.city) return false
    if (filter.category && bookmark.category !== filter.category) return false
    if (!query) return true
    return [bookmark.name, bookmark.address, bookmark.memo].some(
      (field) => field?.toLowerCase().includes(query) ?? false
    )
  })
}

// 이 여행에 이미 담긴 북마크인지: 복사 시 남긴 bookmark_id(provenance) 또는
// 같은 place_id로 판정한다. 직접 입력으로 이미 추가된 같은 장소도 잡기 위함.
export function isBookmarkImported(
  bookmark: Bookmark,
  spots: Pick<Spot, 'bookmark_id' | 'place_id'>[]
): boolean {
  return spots.some(
    (spot) =>
      spot.bookmark_id === bookmark.id ||
      (bookmark.place_id !== null && spot.place_id === bookmark.place_id)
  )
}
```

`src/lib/spot-categories.ts` (기존 두 파일의 중복 상수 통합):

```ts
import type { SpotCategory } from '@/types/database'

export const CATEGORY_OPTIONS: { value: SpotCategory; label: string }[] = [
  { value: 'sight', label: '관광' },
  { value: 'restaurant', label: '식당' },
  { value: 'cafe', label: '카페' },
  { value: 'shopping', label: '쇼핑' },
  { value: 'lodging', label: '숙소' },
  { value: 'etc', label: '기타' },
]

export const CATEGORY_LABELS: Record<SpotCategory, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((option) => [option.value, option.label])
) as Record<SpotCategory, string>
```

- [ ] **Step 4: add-spot-dialog.tsx와 spot-panel.tsx의 로컬 CATEGORY_* 상수를 import로 교체** (동작 동일; spot-panel의 `Record<string, string>` 타입은 `CATEGORY_LABELS[spot.category]` 그대로 호환)

- [ ] **Step 5: 테스트·린트 통과 확인** — `pnpm test`, `pnpm lint`

- [ ] **Step 6: Commit** — `feat: add address/bookmark filter helpers and shared category constants`

---

### Task 4: PlaceSearchInput 추출 + AddSpotDialog 교체

**Files:**
- Create: `src/components/places/place-search-input.tsx`
- Modify: `src/app/trips/[tripId]/plan/add-spot-dialog.tsx`

**Interfaces:**
- Consumes: `useAutocompleteSuggestions`, `extractCountryCity` (Task 3)
- Produces:

```ts
export interface PlaceSelection {
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  placeId: string
  country: string | null
  city: string | null
}
```

`PlaceSearchInput({ value, onValueChange, onSelect, onError, placeholder })` — Task 5·6의 다이얼로그가 사용.

- [ ] **Step 1: place-search-input.tsx 구현**

```tsx
'use client'

import { useAutocompleteSuggestions } from '@/lib/places/use-autocomplete-suggestions'
import { extractCountryCity } from '@/lib/places/address'
import { Input } from '@/components/ui/input'

export interface PlaceSelection {
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  placeId: string
  country: string | null
  city: string | null
}

// AddSpotDialog에서 추출한 Places 검색 입력. 타이핑하면 onValueChange로 부모가
// 이전 선택을 무효화하고, 제안을 선택하면 상세를 조회해 onSelect로 전달한다.
// fetchFields 실패 시 폼 상태를 건드리지 않고 onError만 호출한다(기존 방어 패턴).
export function PlaceSearchInput({
  value,
  onValueChange,
  onSelect,
  onError,
  placeholder,
}: {
  value: string
  onValueChange: (value: string) => void
  onSelect: (selection: PlaceSelection) => void
  onError: (message: string) => void
  placeholder?: string
}) {
  const { suggestions, resetSession } = useAutocompleteSuggestions(value)

  const selectSuggestion = async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    if (!suggestion.placePrediction) return
    const place = suggestion.placePrediction.toPlace()
    try {
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location', 'addressComponents'],
      })
    } catch (error) {
      console.error('selectSuggestion failed:', error)
      onError('장소 정보를 불러오지 못했습니다. 다시 시도해 주세요.')
      return
    }

    const { country, city } = extractCountryCity(place.addressComponents)
    onSelect({
      name: place.displayName ?? '',
      address: place.formattedAddress ?? null,
      // place.location은 google.maps.LatLng 객체 — .lat()/.lng() 호출 필요.
      lat: place.location ? place.location.lat() : null,
      lng: place.location ? place.location.lng() : null,
      placeId: suggestion.placePrediction.placeId,
      country,
      city,
    })
    resetSession()
  }

  return (
    <div>
      <Input value={value} onChange={(e) => onValueChange(e.target.value)} placeholder={placeholder} />
      {suggestions.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border text-sm">
          {suggestions.map((suggestion, index) => (
            <li
              key={index}
              className="cursor-pointer px-2 py-1.5 hover:bg-accent"
              onClick={() => selectSuggestion(suggestion)}
            >
              {suggestion.placePrediction?.text.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

주의: `place.addressComponents`의 각 항목은 `{ longText, types }`를 갖는 `google.maps.places.AddressComponent` — `AddressComponentLike`와 구조 호환.

- [ ] **Step 2: AddSpotDialog를 PlaceSearchInput 사용으로 교체**
  - `useAutocompleteSuggestions` import·호출, `selectSuggestion` 함수, 이름 Input+제안 ul 블록, `resetSession()` 호출(reset 함수와 [open] effect 안 포함)을 제거.
  - 이름 필드 자리에:

```tsx
<PlaceSearchInput
  value={name}
  onValueChange={(value) => {
    setName(value)
    setPlaceId(null)
    setLat(null)
    setLng(null)
    setAddress(null)
  }}
  onSelect={(selection) => {
    setName(selection.name)
    setAddress(selection.address)
    setLat(selection.lat)
    setLng(selection.lng)
    setPlaceId(selection.placeId)
  }}
  onError={setError}
  placeholder="예: 두오모 (검색해서 선택하면 지도에 표시됩니다)"
/>
{address && <p className="mt-1 text-xs text-muted-foreground">{address}</p>}
```

  - 스팟 생성은 country/city를 사용하지 않는다(무시).

- [ ] **Step 3: 테스트·린트·빌드** — `pnpm test`, `pnpm lint`, `pnpm build`

- [ ] **Step 4: Commit** — `refactor: extract PlaceSearchInput shared component from AddSpotDialog`

---

### Task 5: `/places` 화면 — 라이브러리 목록·검색·필터·추가/수정/삭제

**Files:**
- Create: `src/app/places/page.tsx`
- Create: `src/app/places/places-library.tsx`
- Create: `src/app/places/bookmark-dialog.tsx`
- Modify: `src/app/home/page.tsx` (헤더에 "저장한 장소" 링크)

**Interfaces:**
- Consumes: `listMyBookmarks`, `createBookmark`, `updateBookmark`, `deleteBookmark`, `filterBookmarks`, `PlaceSearchInput`, `CATEGORY_OPTIONS`/`CATEGORY_LABELS`

- [ ] **Step 1: page.tsx**

```tsx
import Link from 'next/link'
import { listMyBookmarks } from '@/lib/bookmarks/queries'
import { MapProvider } from '@/components/map/map-provider'
import { Button } from '@/components/ui/button'
import { PlacesLibrary } from './places-library'

export default async function PlacesPage() {
  const bookmarks = await listMyBookmarks()

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">저장한 장소</h1>
        <Button variant="outline" render={<Link href="/home">내 여행</Link>} />
      </div>
      <MapProvider>
        <PlacesLibrary bookmarks={bookmarks} />
      </MapProvider>
    </main>
  )
}
```

(미인증 접근은 기존 미들웨어가 `/login`으로 리다이렉트 — `/places`는 PUBLIC_PATHS에 없음.)

- [ ] **Step 2: places-library.tsx** — 검색 입력, 국가/도시/카테고리 칩(보유 데이터에서 도출, 같은 칩 재클릭 시 해제), 목록 행(이름·카테고리·국가/도시·메모, 수정/삭제), 추가 버튼. 삭제는 `confirm()` 후 `deleteBookmark`. 칩·목록은 `filterBookmarks` 사용. 필터 상태는 `useState`, 다이얼로그 상태는 `{ mode: 'closed' } | { mode: 'add' } | { mode: 'edit'; bookmark: Bookmark }`.

- [ ] **Step 3: bookmark-dialog.tsx** — 추가·수정 겸용.
  - props: `{ open, onOpenChange, editing: Bookmark | null, existing: Bookmark[] }`
  - 추가 모드: PlaceSearchInput(+ 주소 미리보기) → 선택 시 name/address/lat/lng/placeId/country/city 채움. `placeId`가 `existing`(수정 중인 자신 제외)의 `place_id`와 일치하면 "이미 저장된 장소예요: {기존 이름}" 안내를 보여주고 저장 버튼 비활성화.
  - 공통 필드: 카테고리 Select(CATEGORY_OPTIONS), 국가 Input, 도시 Input, 메모 Textarea.
  - 수정 모드: PlaceSearchInput 대신 일반 Input(이름) — place_id·좌표는 유지.
  - 제출: 추가 → `createBookmark`, 수정 → `updateBookmark`. 상태 초기화는 AddSpotDialog와 같은 `[open]` effect 패턴(수정 모드는 editing 값으로 초기화).

- [ ] **Step 4: home/page.tsx 헤더에 링크 추가** — "+ 새 여행 만들기" 옆에 `<Button variant="outline" render={<Link href="/places">저장한 장소</Link>} />`

- [ ] **Step 5: 테스트·린트·빌드** — `pnpm test`, `pnpm lint`, `pnpm build`

- [ ] **Step 6: Commit** — `feat: add saved-places library page (/places)`

---

### Task 6: 플랜 패널 "저장한 장소에서 담기"

**Files:**
- Create: `src/app/trips/[tripId]/plan/import-bookmarks-dialog.tsx`
- Modify: `src/app/trips/[tripId]/plan/page.tsx` (`listMyBookmarks()` 추가 조회 → SpotPanel에 전달)
- Modify: `src/app/trips/[tripId]/plan/spot-panel.tsx` (버튼·다이얼로그 연결)

**Interfaces:**
- Consumes: `importBookmarks(tripId, bookmarkIds)`, `filterBookmarks`, `isBookmarkImported`, `listMyBookmarks`

- [ ] **Step 1: import-bookmarks-dialog.tsx**

```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { importBookmarks } from '@/lib/bookmarks/actions'
import { filterBookmarks, isBookmarkImported } from '@/lib/bookmarks/filter'
import type { Bookmark, Spot } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

export function ImportBookmarksDialog({
  tripId,
  bookmarks,
  spots,
  open,
  onOpenChange,
}: {
  tripId: number
  bookmarks: Bookmark[]
  spots: Spot[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(new Set())
      setError(null)
    }
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  const visible = filterBookmarks(bookmarks, { query, country: null, city: null, category: null })

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = () => {
    startTransition(async () => {
      const result = await importBookmarks(tripId, [...selected])
      if (result.error) setError(result.error)
      else onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>저장한 장소에서 담기</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·주소·메모 검색" />
          {bookmarks.length === 0 && (
            <p className="text-sm text-muted-foreground">저장한 장소가 없습니다. 저장한 장소 화면에서 먼저 추가해 주세요.</p>
          )}
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {visible.map((bookmark) => {
              const imported = isBookmarkImported(bookmark, spots)
              return (
                <li key={bookmark.id}>
                  <label
                    className={`flex items-center gap-2 rounded border p-2 text-sm ${
                      imported ? 'text-muted-foreground' : 'cursor-pointer hover:bg-accent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={imported}
                      checked={selected.has(bookmark.id)}
                      onChange={() => toggle(bookmark.id)}
                    />
                    <span className="flex-1">{bookmark.name}</span>
                    {imported ? (
                      <span className="text-xs">담김</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {[bookmark.city, bookmark.country].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={isPending || selected.size === 0}>
            {isPending ? '담는 중…' : `${selected.size}개 담기`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: plan/page.tsx** — `listMyBookmarks` import, `Promise.all`에 추가, `<SpotPanel tripId=... spots=... groups=... bookmarks={bookmarks} />`

- [ ] **Step 3: spot-panel.tsx** — `bookmarks: Bookmark[]` prop 추가, "담기" 버튼과 `ImportBookmarksDialog` 연결 (기존 "+ 장소 추가" 옆에 outline 버튼 "저장한 장소에서").

- [ ] **Step 4: 테스트·린트·빌드** — `pnpm test`, `pnpm lint`, `pnpm build`

- [ ] **Step 5: Commit** — `feat: import saved places into a trip from the plan spot panel`

---

### Task 7: 최종 검증·푸시

- [ ] **Step 1: 전체 게이트 실행** — `pnpm test`(단위 전체 통과, RLS 실패는 env 부재 사유만), `pnpm lint`, `pnpm build`
- [ ] **Step 2: 스펙 대비 누락 확인** — 스펙 §1–7 각 항목이 커밋에 존재하는지 훑기
- [ ] **Step 3: push** — `git push origin main`
