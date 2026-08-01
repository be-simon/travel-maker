# M2 Timeline Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, click-based trip planner: a trip's "플랜" screen with a 장소 (spots) panel on the left and a date × time timeline canvas on the right, where a signed-in trip member can add a spot, click an empty timeline slot to create a block, and click an existing block to edit or delete it — the core of F4 (타임라인 플래너) and enough of F3's trip-scoped half (스팟 CRUD) to make F4 usable, from `docs/PRD.md`.

**Architecture:** Same shape as M1 — Next.js Server Components for data fetching, Server Actions for mutations, Supabase RLS as the only authorization layer. The timeline itself is a single client component (`TimelineView`) that receives server-fetched data as props and manages only local UI state (which dialog is open, with what draft); every mutation still goes through a Server Action + `revalidatePath`, matching the pattern already proven in M1 (`inviteMember`/`acceptInvite` called via `useTransition` from a client component, refreshed automatically via `revalidatePath` — no manual `router.refresh()` needed).

**Tech Stack:** Same as M1 (Next.js 16 App Router, TypeScript, Tailwind v4, shadcn/ui on Base UI, Supabase). No new dependencies — `dnd-kit` was added to `package.json` during initial scaffolding but is **not used by this plan** (see Global Constraints).

## Global Constraints

- Package manager is **pnpm**.
- All user-facing copy is **Korean**, matching `docs/PRD.md` terminology exactly (e.g. "장소", "일정", "관광"/"식당"/"카페"/"쇼핑"/"숙소"/"기타" for `SpotCategory`, "스팟"/"이동"/"숙소"/"자유 메모" for `BlockType`).
- Never instantiate a Supabase client ad hoc — always `createClient()` from `src/lib/supabase/client.ts` (browser) or `src/lib/supabase/server.ts` (server), both already built in M1.
- The DB schema is **already migrated and verified** — `supabase/migrations/20260802000000_plan_blocks.sql` (on top of M1's three migrations) adds `plan_blocks` with the same RLS pattern as `spots`/`spot_groups` (`private.is_trip_member`, any active member can write, no viewer role in MVP). Do not modify any existing migration; if a task appears to need a schema change, stop and flag it instead.
- `src/components/ui/dialog.tsx`, `select.tsx`, and `textarea.tsx` are **already added** (Base UI-backed, matching the existing `button.tsx`/`input.tsx`). Their real generated API was inspected directly before writing this plan's code (not assumed from generic shadcn examples) — use them exactly as shown in each task's code, don't "fix" prop names that look unfamiliar from Radix-based shadcn docs.
- Every Server Action returns `{ error: string | null }` and follows the exact M1 pattern: validate → mutate → on Supabase error, `console.error(...)` + a generic Korean fallback (`'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'`) — never `return { error: error.message }` verbatim (this leaked raw Postgres errors into the UI in M1 and was fixed; don't reintroduce it).
- **Scope cuts, all deliberate — do not treat their absence as a gap:**
  - **F5 (지도 뷰) is entirely out of scope.** The 플랜 screen's canvas is timeline-only this round; the PRD's 타임라인⇄지도 토글 is not built yet. A follow-up plan adds the map view and the toggle.
  - **Drag-based interactions are out of scope.** F4 calls for drag-to-create (15분 스냅), drag-to-move (같은 날짜 내), and edge-drag-to-resize. This plan ships **click-to-create** (click an empty slot → dialog pre-filled with that time) and **click-to-edit** (click a block → edit/delete dialog) instead — a fully working, testable timeline without the highest-risk interaction code. A follow-up plan (M2b) adds real dragging on top of this same data layer and `TimelineView` component.
  - **Undo toast is out of scope.** PRD ties this to accidental drag mistakes; click-based deliberate actions (this plan) don't carry the same risk, and dragging (which does) isn't built yet either. Reconsider when M2b lands.
  - **Travel-time hints between blocks are out of scope.** They need spot coordinates (`lat`/`lng`), which need either Google Places (no API key configured yet — a manual external-setup step like Google OAuth's, not done in this session) or F3's bookmark import (also not built). Spots created by this plan have `lat`/`lng` left `null`.
  - **Google Places search when adding a spot is out of scope**, same reason (no Maps Platform API key configured). This plan's "장소 추가" is direct manual entry only (name/category/city/memo) — matching how M1's trip-creation wizard handled the analogous "저장한 장소 가져오기" gap.
  - **"저장한 장소에서 담기" (importing account-level bookmarks into a trip) is out of scope** — F3's account-level bookmark library still doesn't exist (deferred in M1, still deferred here).
  - **Editing or deleting a spot itself (after creation) is out of scope.** Only create. Matches M1's trip-edit/delete cut — same category of deliberate narrowing, tracked here the same way.
  - **Mobile responsive layout is out of scope.** PRD calls for a day-by-day vertical list view on mobile; this plan's `TimelineView` is desktop-oriented (horizontally-scrolling day columns) only.
  - **Dragging a spot card from the 장소 패널 directly onto a timeline slot is out of scope**, same "drag interactions" cut as above (this is a distinct, cross-container drag from the intra-grid drag-to-move/resize already listed, so calling it out separately here). This plan's substitute: Task 6's block-create dialog has a 장소 dropdown, so attaching a spot to a new block is still fully possible — just via click + select, not drag.
  - **Task 6's block editor is a modal `Dialog`, not an inline popover anchored to the clicked block**, though PRD F4 describes "전체 화면 이동 없이 인라인 팝오버". A modal was chosen for implementation simplicity at this stage (anchored-popover positioning/viewport-collision handling is real extra complexity, and `AddSpotDialog` already established the modal pattern in Task 4) — functionally equivalent (no full-page navigation, same fields, same immediacy), just not pixel-literal to the PRD's popover description. Revisit if this reads as jarring once built.
  - A spot's `status` flips to `'planned'` when a block is created referencing it, but does **not** revert to `'candidate'` if that block is later deleted (even if it was the spot's only block). Documented, deliberate simplification — not a bug to fix in this plan.

---

### Task 1: Trip workspace layout refactor

Extracts the shared trip header/nav (currently duplicated inline in the single existing `src/app/trips/[tripId]/page.tsx`) into a layout, so the upcoming `/plan` route doesn't have to re-fetch and re-render the same header. Moves the existing members UI to its own route.

**Files:**
- Create: `src/app/trips/[tripId]/layout.tsx`
- Create: `src/app/trips/[tripId]/trip-nav.tsx`
- Create: `src/app/trips/[tripId]/members/page.tsx` (moved content from the old `page.tsx`, header/nav removed — now provided by the layout)
- Move: `src/app/trips/[tripId]/invite-form.tsx` → `src/app/trips/[tripId]/members/invite-form.tsx`
- Modify: `src/app/trips/[tripId]/page.tsx` (becomes a thin redirect to `/trips/[tripId]/members`)
- Modify: `src/lib/trips/queries.ts` (wrap `getTrip` in React's `cache()` so the layout and any page under it share one DB round trip per request instead of querying twice)

**Interfaces:**
- Consumes: `getTrip`, `listTripMembers` (existing, from `src/lib/trips/queries.ts`); `inviteMember` (existing, from `src/lib/trips/actions.ts`).
- Produces: nothing new consumed by later tasks in this plan — Task 4 will add its own `src/app/trips/[tripId]/plan/page.tsx` as a sibling route, automatically picking up this task's `layout.tsx`.

- [ ] **Step 1: Wrap `getTrip` in React `cache()`**

In `src/lib/trips/queries.ts`, change:

```ts
import { createClient } from '@/lib/supabase/server'
import type { Trip, TripMember } from '@/types/database'
```

to:

```ts
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Trip, TripMember } from '@/types/database'
```

and change the `getTrip` function from:

```ts
export async function getTrip(tripId: number): Promise<Trip | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).maybeSingle()
  if (error) throw error
  return data
}
```

to:

```ts
export const getTrip = cache(async (tripId: number): Promise<Trip | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).maybeSingle()
  if (error) throw error
  return data
})
```

Leave every other function in this file untouched.

- [ ] **Step 2: Write `src/app/trips/[tripId]/trip-nav.tsx`**

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function TripNav({ tripId }: { tripId: number }) {
  const pathname = usePathname()
  const isPlan = pathname?.startsWith(`/trips/${tripId}/plan`)
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
        href={`/trips/${tripId}/members`}
        className={isMembers ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}
      >
        멤버
      </Link>
      <span className="text-muted-foreground">Today (M3에서 제공)</span>
    </nav>
  )
}
```

- [ ] **Step 3: Write `src/app/trips/[tripId]/layout.tsx`**

```tsx
import { notFound } from 'next/navigation'
import { getTrip } from '@/lib/trips/queries'
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

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">{trip.title}</h1>
        <p className="text-sm text-muted-foreground">
          {trip.start_date} – {trip.end_date}
        </p>
      </header>

      <TripNav tripId={trip.id} />

      {children}
    </main>
  )
}
```

- [ ] **Step 4: Move `invite-form.tsx` and write `src/app/trips/[tripId]/members/page.tsx`**

```bash
git mv src/app/trips/[tripId]/invite-form.tsx src/app/trips/[tripId]/members/invite-form.tsx
```

Write `src/app/trips/[tripId]/members/page.tsx` (the old `page.tsx`'s body, minus the header/`<main>`/nav — those now live in the layout — and with the import path updated to match the moved `invite-form.tsx`):

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTrip, listTripMembers } from '@/lib/trips/queries'
import { InviteForm } from './invite-form'

export default async function MembersPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  if (!/^\d+$/.test(tripId)) notFound()
  const numericTripId = Number(tripId)

  const trip = await getTrip(numericTripId)
  if (!trip) notFound()

  const members = await listTripMembers(trip.id)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const currentMember = members.find((member) => member.user_id === user?.id)
  const canInvite = currentMember?.role === 'owner'

  return (
    <section className="space-y-4">
      <ul className="space-y-2">
        {members.map((member) => (
          <li key={member.id} className="flex items-center justify-between rounded-lg border p-3">
            <span>{member.invited_email}</span>
            <span className="flex gap-2 text-xs">
              <span className="rounded-full bg-secondary px-2 py-0.5">
                {member.role === 'owner' ? '오너' : '에디터'}
              </span>
              <span className="rounded-full bg-secondary px-2 py-0.5">
                {member.status === 'active' ? '참여중' : '초대중'}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {canInvite && <InviteForm tripId={trip.id} />}
    </section>
  )
}
```

(Note: `getTrip` is called here again, but thanks to Step 1's `cache()`, this reuses the same request-scoped result the layout already fetched — no second DB round trip.)

- [ ] **Step 5: Rewrite `src/app/trips/[tripId]/page.tsx` as a redirect**

```tsx
import { redirect } from 'next/navigation'

export default async function TripIndexPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  redirect(`/trips/${tripId}/members`)
}
```

(This redirects to `/members` for now, not `/plan` — `/plan` doesn't exist until Task 4. Task 4 flips this target once it does, so this route never points at a 404 in between.)

- [ ] **Step 6: Verify**

Run: `pnpm build`
Expected: succeeds, route list shows `/trips/[tripId]`, `/trips/[tripId]/members` as separate entries, no `/trips/[tripId]/invite-form` (that file has no default export, so it was never a route — confirm it only shows up as a shared chunk, not a route).

Run: `pnpm dev`, then as a logged-in user (or via the same session-cookie-injection approach M1's Task 7/8 used against local Supabase) visit `/trips/<id>` — confirm it redirects to `/trips/<id>/members` and the page renders identically to before (header, nav with 플랜/멤버 links, member list, invite form if owner). Click "플랜" — confirm it navigates to `/trips/<id>/plan` (a 404 is expected and fine until Task 4 — the important thing is the layout's header/nav render above the 404, proving the layout itself works for a route that doesn't exist yet).

- [ ] **Step 7: Commit**

```bash
git add src/app/trips/\[tripId\] src/lib/trips/queries.ts
git commit -m "refactor: extract trip workspace layout, move members to its own route"
```

---

### Task 2: Spots + spot_groups data layer

**Files:**
- Create: `src/lib/spots/validation.ts`
- Create: `src/lib/spots/validation.test.ts`
- Create: `src/lib/spots/queries.ts`
- Create: `src/lib/spots/actions.ts`

**Interfaces:**
- Produces: `validateSpotName(name: string): string | null` — used by `actions.ts` below.
- Produces: `listSpotsByTrip(tripId: number): Promise<Spot[]>`, `listSpotGroupsByTrip(tripId: number): Promise<SpotGroup[]>` — used by Task 4's plan page and spot panel.
- Produces: `createSpot(input: { tripId: number; name: string; category: SpotCategory; memo: string; groupId: number | null; newGroupName: string }): Promise<{ error: string | null }>` — used by Task 4's add-spot dialog. Exactly one of `groupId`/`newGroupName` should be meaningful per call (UI enforces this — see Task 4); if `groupId` is null and `newGroupName` is non-empty, a new `spot_groups` row is created and used.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spots/validation.test.ts
import { describe, it, expect } from 'vitest'
import { validateSpotName } from './validation'

describe('validateSpotName', () => {
  it('rejects an empty name', () => {
    expect(validateSpotName('')).toBe('장소 이름을 입력해 주세요.')
  })

  it('rejects a whitespace-only name', () => {
    expect(validateSpotName('   ')).toBe('장소 이름을 입력해 주세요.')
  })

  it('accepts a valid name', () => {
    expect(validateSpotName('두오모')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/spots/validation.test.ts`
Expected: FAIL — `Cannot find module './validation'`.

- [ ] **Step 3: Write `src/lib/spots/validation.ts`**

```ts
export function validateSpotName(name: string): string | null {
  if (!name.trim()) return '장소 이름을 입력해 주세요.'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/spots/validation.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Write `src/lib/spots/queries.ts`**

```ts
import { createClient } from '@/lib/supabase/server'
import type { Spot, SpotGroup } from '@/types/database'

export async function listSpotsByTrip(tripId: number): Promise<Spot[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('spots')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function listSpotGroupsByTrip(tripId: number): Promise<SpotGroup[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('spot_groups')
    .select('*')
    .eq('trip_id', tripId)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return data
}
```

- [ ] **Step 6: Write `src/lib/spots/actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { validateSpotName } from './validation'
import type { SpotCategory } from '@/types/database'

export interface ActionResult {
  error: string | null
}

export async function createSpot(input: {
  tripId: number
  name: string
  category: SpotCategory
  memo: string
  groupId: number | null
  newGroupName: string
}): Promise<ActionResult> {
  const nameError = validateSpotName(input.name)
  if (nameError) return { error: nameError }

  const supabase = await createClient()

  let groupId = input.groupId
  if (!groupId && input.newGroupName.trim()) {
    const { data: group, error: groupError } = await supabase
      .from('spot_groups')
      .insert({ trip_id: input.tripId, name: input.newGroupName.trim(), sort_order: 0 })
      .select()
      .single()

    if (groupError) {
      console.error('createSpot (group) failed:', groupError)
      return { error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
    }
    groupId = group.id
  }

  const { error } = await supabase.from('spots').insert({
    trip_id: input.tripId,
    group_id: groupId,
    name: input.name.trim(),
    category: input.category,
    memo: input.memo.trim() || null,
    status: 'candidate',
  })

  if (error) {
    console.error('createSpot failed:', error)
    return { error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  revalidatePath(`/trips/${input.tripId}/plan`)
  return { error: null }
}
```

- [ ] **Step 7: Type-check**

Run: `pnpm build`
Expected: succeeds (nothing imports these files yet — this only checks the files themselves are valid TypeScript; Task 4 wires them in).

- [ ] **Step 8: Commit**

```bash
git add src/lib/spots
git commit -m "feat: add spot/spot_group validation, queries, and Server Actions"
```

---

### Task 3: plan_blocks data layer

**Files:**
- Create: `src/lib/plan-blocks/validation.ts`
- Create: `src/lib/plan-blocks/validation.test.ts`
- Create: `src/lib/plan-blocks/queries.ts`
- Create: `src/lib/plan-blocks/actions.ts`
- Modify: `src/types/database.ts` (add `BlockType` and `PlanBlock`)

**Interfaces:**
- Produces: `validateBlockTitle(title: string): string | null`, `validateBlockTimes(startTime: string, endTime: string): string | null` — used by `actions.ts` below.
- Produces: `listBlocksByTrip(tripId: number): Promise<PlanBlock[]>` — used by Task 5's plan page.
- Produces: `BlockInput` type, `createBlock(input: BlockInput): Promise<ActionResult>`, `updateBlock(blockId: number, tripId: number, input: Omit<BlockInput, 'tripId'>): Promise<ActionResult>`, `deleteBlock(blockId: number, tripId: number): Promise<ActionResult>` — used by Task 6's block dialog. `BlockInput` is `{ tripId: number; date: string; startTime: string; endTime: string; type: BlockType; spotId: number | null; title: string; memo: string }` — `startTime`/`endTime` are full `HH:MM:SS` strings (Task 6's dialog is responsible for padding a `HH:MM` input value before calling these).
- Produces: `BlockType` (`'spot' | 'transport' | 'lodging' | 'memo'`), `PlanBlock` interface — used by Task 5 and 6.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/plan-blocks/validation.test.ts
import { describe, it, expect } from 'vitest'
import { validateBlockTitle, validateBlockTimes } from './validation'

describe('validateBlockTitle', () => {
  it('rejects an empty title', () => {
    expect(validateBlockTitle('')).toBe('제목을 입력해 주세요.')
  })

  it('accepts a valid title', () => {
    expect(validateBlockTitle('두오모 투어')).toBeNull()
  })
})

describe('validateBlockTimes', () => {
  it('rejects missing times', () => {
    expect(validateBlockTimes('', '10:00:00')).toBe('시작 시간과 종료 시간을 입력해 주세요.')
  })

  it('rejects an end time not after the start time', () => {
    expect(validateBlockTimes('10:00:00', '10:00:00')).toBe('종료 시간은 시작 시간보다 늦어야 합니다.')
    expect(validateBlockTimes('10:30:00', '10:00:00')).toBe('종료 시간은 시작 시간보다 늦어야 합니다.')
  })

  it('accepts a valid range', () => {
    expect(validateBlockTimes('09:00:00', '10:30:00')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/plan-blocks/validation.test.ts`
Expected: FAIL — `Cannot find module './validation'`.

- [ ] **Step 3: Write `src/lib/plan-blocks/validation.ts`**

```ts
export function validateBlockTitle(title: string): string | null {
  if (!title.trim()) return '제목을 입력해 주세요.'
  return null
}

export function validateBlockTimes(startTime: string, endTime: string): string | null {
  if (!startTime || !endTime) return '시작 시간과 종료 시간을 입력해 주세요.'
  if (endTime <= startTime) return '종료 시간은 시작 시간보다 늦어야 합니다.'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/plan-blocks/validation.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Add `BlockType`/`PlanBlock` to `src/types/database.ts`**

Add near the other type unions at the top of the file:

```ts
export type BlockType = 'spot' | 'transport' | 'lodging' | 'memo'
```

Add near the other interfaces (after `Spot`, at the end of the file):

```ts
export interface PlanBlock {
  id: number
  trip_id: number
  date: string
  start_time: string
  end_time: string
  type: BlockType
  spot_id: number | null
  title: string
  memo: string | null
  created_at: string
  updated_at: string
}
```

Leave every existing type/interface in the file untouched.

- [ ] **Step 6: Write `src/lib/plan-blocks/queries.ts`**

```ts
import { createClient } from '@/lib/supabase/server'
import type { PlanBlock } from '@/types/database'

export async function listBlocksByTrip(tripId: number): Promise<PlanBlock[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plan_blocks')
    .select('*')
    .eq('trip_id', tripId)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })
  if (error) throw error
  return data
}
```

- [ ] **Step 7: Write `src/lib/plan-blocks/actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { validateBlockTimes, validateBlockTitle } from './validation'
import type { BlockType } from '@/types/database'

export interface ActionResult {
  error: string | null
}

export interface BlockInput {
  tripId: number
  date: string
  startTime: string
  endTime: string
  type: BlockType
  spotId: number | null
  title: string
  memo: string
}

export async function createBlock(input: BlockInput): Promise<ActionResult> {
  const titleError = validateBlockTitle(input.title)
  if (titleError) return { error: titleError }
  const timeError = validateBlockTimes(input.startTime, input.endTime)
  if (timeError) return { error: timeError }

  const supabase = await createClient()
  const { error } = await supabase.from('plan_blocks').insert({
    trip_id: input.tripId,
    date: input.date,
    start_time: input.startTime,
    end_time: input.endTime,
    type: input.type,
    spot_id: input.spotId,
    title: input.title.trim(),
    memo: input.memo.trim() || null,
  })

  if (error) {
    console.error('createBlock failed:', error)
    return { error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  // 스팟을 일정에 배치하면 장소 패널에서 "배치됨" 상태로 보이게 한다. 이 업데이트가
  // 실패해도 블록 생성 자체는 이미 성공했으므로 사용자에게 에러를 보여주지 않고
  // 로그만 남긴다 — Global Constraints에 명시한 대로 상태 되돌리기(delete 시
  // candidate로 복귀)는 이번 스코프에 없으므로 대칭적으로 다루지 않는다.
  if (input.spotId) {
    const { error: spotError } = await supabase
      .from('spots')
      .update({ status: 'planned' })
      .eq('id', input.spotId)
    if (spotError) console.error('createBlock: failed to mark spot as planned:', spotError)
  }

  revalidatePath(`/trips/${input.tripId}/plan`)
  return { error: null }
}

export async function updateBlock(
  blockId: number,
  tripId: number,
  input: Omit<BlockInput, 'tripId'>
): Promise<ActionResult> {
  const titleError = validateBlockTitle(input.title)
  if (titleError) return { error: titleError }
  const timeError = validateBlockTimes(input.startTime, input.endTime)
  if (timeError) return { error: timeError }

  const supabase = await createClient()
  const { error } = await supabase
    .from('plan_blocks')
    .update({
      date: input.date,
      start_time: input.startTime,
      end_time: input.endTime,
      type: input.type,
      spot_id: input.spotId,
      title: input.title.trim(),
      memo: input.memo.trim() || null,
    })
    .eq('id', blockId)

  if (error) {
    console.error('updateBlock failed:', error)
    return { error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  revalidatePath(`/trips/${tripId}/plan`)
  return { error: null }
}

export async function deleteBlock(blockId: number, tripId: number): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('plan_blocks').delete().eq('id', blockId)

  if (error) {
    console.error('deleteBlock failed:', error)
    return { error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  revalidatePath(`/trips/${tripId}/plan`)
  return { error: null }
}
```

- [ ] **Step 8: Type-check**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/lib/plan-blocks src/types/database.ts
git commit -m "feat: add plan_blocks validation, queries, and Server Actions"
```

---

### Task 4: Plan screen shell + 장소 패널

**Files:**
- Create: `src/app/trips/[tripId]/plan/page.tsx`
- Create: `src/app/trips/[tripId]/plan/spot-panel.tsx`
- Create: `src/app/trips/[tripId]/plan/add-spot-dialog.tsx`
- Modify: `src/app/trips/[tripId]/page.tsx` (flip the redirect target from `/members` to `/plan`, now that `/plan` exists)

**Interfaces:**
- Consumes: `listSpotsByTrip`, `listSpotGroupsByTrip` (Task 2), `createSpot` (Task 2), `getTrip` (existing, cached per Task 1).
- Produces: nothing new consumed elsewhere in this plan — Task 5 modifies this same `page.tsx` to add the timeline canvas alongside this task's panel.

- [ ] **Step 1: Write `src/app/trips/[tripId]/plan/add-spot-dialog.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { createSpot } from '@/lib/spots/actions'
import type { SpotCategory, SpotGroup } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const CATEGORY_OPTIONS: { value: SpotCategory; label: string }[] = [
  { value: 'sight', label: '관광' },
  { value: 'restaurant', label: '식당' },
  { value: 'cafe', label: '카페' },
  { value: 'shopping', label: '쇼핑' },
  { value: 'lodging', label: '숙소' },
  { value: 'etc', label: '기타' },
]

export function AddSpotDialog({
  tripId,
  groups,
  open,
  onOpenChange,
}: {
  tripId: number
  groups: SpotGroup[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<SpotCategory>('sight')
  const [groupId, setGroupId] = useState<string>('new')
  const [newGroupName, setNewGroupName] = useState('')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const reset = () => {
    setName('')
    setCategory('sight')
    setGroupId('new')
    setNewGroupName('')
    setMemo('')
    setError(null)
  }

  const submit = () => {
    startTransition(async () => {
      const result = await createSpot({
        tripId,
        name,
        category,
        memo,
        groupId: groupId === 'new' ? null : Number(groupId),
        newGroupName: groupId === 'new' ? newGroupName : '',
      })
      if (result.error) {
        setError(result.error)
      } else {
        reset()
        onOpenChange(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>장소 추가</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">이름</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 두오모" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">카테고리</label>
            <Select value={category} onValueChange={(value) => setCategory(value as SpotCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">도시/지역</label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">+ 새 그룹</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={String(group.id)}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {groupId === 'new' && (
              <Input
                className="mt-2"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="예: 피렌체"
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">메모</label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? '추가하는 중…' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Write `src/app/trips/[tripId]/plan/spot-panel.tsx`**

```tsx
'use client'

import { useState } from 'react'
import type { Spot, SpotGroup } from '@/types/database'
import { Button } from '@/components/ui/button'
import { AddSpotDialog } from './add-spot-dialog'

const CATEGORY_LABELS: Record<string, string> = {
  sight: '관광',
  restaurant: '식당',
  cafe: '카페',
  shopping: '쇼핑',
  lodging: '숙소',
  etc: '기타',
}

const STATUS_LABELS: Record<string, string> = {
  candidate: '후보',
  planned: '배치됨',
  visited: '방문완료',
}

function SpotRow({ spot }: { spot: Spot }) {
  return (
    <li className="flex items-center justify-between rounded border p-2 text-sm">
      <span>{spot.name}</span>
      <span className="text-xs text-muted-foreground">
        {CATEGORY_LABELS[spot.category]} · {STATUS_LABELS[spot.status]}
      </span>
    </li>
  )
}

export function SpotPanel({
  tripId,
  spots,
  groups,
}: {
  tripId: number
  spots: Spot[]
  groups: SpotGroup[]
}) {
  const [dialogOpen, setDialogOpen] = useState(false)

  const grouped = groups
    .map((group) => ({ group, spots: spots.filter((spot) => spot.group_id === group.id) }))
    .filter(({ spots: groupSpots }) => groupSpots.length > 0)
  const ungrouped = spots.filter((spot) => spot.group_id === null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">장소</h2>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          + 장소 추가
        </Button>
      </div>

      {spots.length === 0 && <p className="text-sm text-muted-foreground">아직 담긴 장소가 없습니다.</p>}

      {grouped.map(({ group, spots: groupSpots }) => (
        <div key={group.id}>
          <h3 className="mb-1 text-sm font-medium text-muted-foreground">{group.name}</h3>
          <ul className="space-y-1">
            {groupSpots.map((spot) => (
              <SpotRow key={spot.id} spot={spot} />
            ))}
          </ul>
        </div>
      ))}

      {ungrouped.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-medium text-muted-foreground">그룹 없음</h3>
          <ul className="space-y-1">
            {ungrouped.map((spot) => (
              <SpotRow key={spot.id} spot={spot} />
            ))}
          </ul>
        </div>
      )}

      <AddSpotDialog tripId={tripId} groups={groups} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
```

- [ ] **Step 3: Write `src/app/trips/[tripId]/plan/page.tsx`**

```tsx
import { notFound } from 'next/navigation'
import { listSpotsByTrip, listSpotGroupsByTrip } from '@/lib/spots/queries'
import { SpotPanel } from './spot-panel'

export default async function PlanPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  if (!/^\d+$/.test(tripId)) notFound()
  const numericTripId = Number(tripId)

  const [spots, groups] = await Promise.all([
    listSpotsByTrip(numericTripId),
    listSpotGroupsByTrip(numericTripId),
  ])

  return (
    <div className="flex gap-6">
      <aside className="w-72 shrink-0">
        <SpotPanel tripId={numericTripId} spots={spots} groups={groups} />
      </aside>
      <section className="flex-1 rounded-lg border p-6 text-sm text-muted-foreground">
        타임라인은 곧 제공됩니다.
      </section>
    </div>
  )
}
```

(`타임라인은 곧 제공됩니다.` is real, correctly-worded placeholder copy for the canvas — Task 5 replaces this `<section>`'s contents with the actual `TimelineView`. This mirrors M1's trip-wizard "coming soon" step: a genuine, honest scope stage, not a code TODO.)

- [ ] **Step 4: Flip the redirect target in `src/app/trips/[tripId]/page.tsx`**

Change:

```tsx
redirect(`/trips/${tripId}/members`)
```

to:

```tsx
redirect(`/trips/${tripId}/plan`)
```

- [ ] **Step 5: Manual verification**

Run: `pnpm build`, then `pnpm dev`. As a logged-in trip member, visit `/trips/<id>` — confirm it now redirects to `/trips/<id>/plan` (not `/members`). Confirm the 장소 패널 renders (empty state if no spots yet), click "+ 장소 추가", fill in a name (leave category/city at defaults), submit — confirm the new spot appears in a "그룹 없음" (또는 새로 만든 그룹) section immediately. Create a second spot with a new city name — confirm it appears under that city's own group heading. Try submitting with an empty name — confirm the inline Korean validation error appears and nothing is created.

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/\[tripId\]/plan src/app/trips/\[tripId\]/page.tsx
git commit -m "feat: add plan screen shell with spot panel and add-spot dialog"
```

---

### Task 5: Timeline grid rendering

Static rendering only — no click interactivity yet (Task 6 adds that). This task's own deliverable is: a horizontally-scrolling column per trip day, each showing existing `plan_blocks` positioned by time, with same-day overlapping blocks laid out side-by-side rather than stacked illegibly on top of each other.

**Files:**
- Create: `src/app/trips/[tripId]/plan/timeline-view.tsx`
- Modify: `src/app/trips/[tripId]/plan/page.tsx` (fetch blocks + trip dates, replace the placeholder `<section>` with `<TimelineView>`)

**Interfaces:**
- Consumes: `listBlocksByTrip` (Task 3), `getTrip` (existing, cached), `PlanBlock`/`Spot`/`BlockType` types.
- Produces: `TimelineView` component accepting `{ startDate: string; endDate: string; blocks: PlanBlock[]; spots: Spot[] }` — Task 6 adds a `tripId` prop and click handlers on top of this same component (does not replace it).

- [ ] **Step 1: Write `src/app/trips/[tripId]/plan/timeline-view.tsx`**

```tsx
'use client'

import type { PlanBlock, Spot } from '@/types/database'

const SLOT_MINUTES = 30
const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES
const PX_PER_SLOT = 28

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

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minutesToPx(minutes: number): number {
  return (minutes / SLOT_MINUTES) * PX_PER_SLOT
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 1)
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

export function TimelineView({
  startDate,
  endDate,
  blocks,
  spots,
}: {
  startDate: string
  endDate: string
  blocks: PlanBlock[]
  spots: Spot[]
}) {
  const dates = enumerateDates(startDate, endDate)
  const spotById = new Map(spots.map((spot) => [spot.id, spot]))
  const dayHeight = SLOTS_PER_DAY * PX_PER_SLOT

  return (
    <div className="flex overflow-x-auto rounded-lg border">
      {dates.map((date) => {
        const dayBlocks = layoutDayBlocks(blocks.filter((block) => block.date === date))

        return (
          <div key={date} className="w-56 shrink-0 border-r last:border-r-0">
            <div className="border-b bg-muted/50 p-2 text-center text-sm font-medium">{date}</div>
            <div
              className="relative"
              style={{
                height: dayHeight,
                backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${PX_PER_SLOT}px)`,
              }}
            >
              {dayBlocks.map((block) => {
                const top = minutesToPx(timeToMinutes(block.start_time))
                const height = minutesToPx(timeToMinutes(block.end_time) - timeToMinutes(block.start_time))
                const widthPercent = 100 / block.columnCount
                const spot = block.spot_id ? spotById.get(block.spot_id) : null

                return (
                  <div
                    key={block.id}
                    className={`absolute overflow-hidden rounded border p-1 text-xs ${TYPE_COLORS[block.type]}`}
                    style={{
                      top,
                      height,
                      left: `${block.column * widthPercent}%`,
                      width: `${widthPercent}%`,
                    }}
                  >
                    <div className="font-medium">{block.title}</div>
                    <div className="text-[10px] opacity-70">
                      {block.start_time.slice(0, 5)}–{block.end_time.slice(0, 5)} · {TYPE_LABELS[block.type]}
                    </div>
                    {spot && <div className="text-[10px] opacity-70">{spot.name}</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Update `src/app/trips/[tripId]/plan/page.tsx`**

Replace the whole file with:

```tsx
import { notFound } from 'next/navigation'
import { getTrip } from '@/lib/trips/queries'
import { listSpotsByTrip, listSpotGroupsByTrip } from '@/lib/spots/queries'
import { listBlocksByTrip } from '@/lib/plan-blocks/queries'
import { SpotPanel } from './spot-panel'
import { TimelineView } from './timeline-view'

export default async function PlanPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  if (!/^\d+$/.test(tripId)) notFound()
  const numericTripId = Number(tripId)

  const trip = await getTrip(numericTripId)
  if (!trip) notFound()

  const [spots, groups, blocks] = await Promise.all([
    listSpotsByTrip(numericTripId),
    listSpotGroupsByTrip(numericTripId),
    listBlocksByTrip(numericTripId),
  ])

  return (
    <div className="flex gap-6">
      <aside className="w-72 shrink-0">
        <SpotPanel tripId={numericTripId} spots={spots} groups={groups} />
      </aside>
      <section className="flex-1">
        <TimelineView startDate={trip.start_date} endDate={trip.end_date} blocks={blocks} spots={spots} />
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Manual verification, including the overlap layout**

Run: `pnpm dev`. As a logged-in trip member on a trip's `/plan` page, use `psql`/`curl` against local Supabase (same pattern used throughout M1's manual verification) to insert 2-3 `plan_blocks` directly for the same day with overlapping time ranges (e.g. 09:00–10:30 and 10:00–11:00) and one non-overlapping block on a different day. Reload `/trips/<id>/plan` and confirm: each day renders as its own column labeled with its date; the two overlapping blocks render side-by-side (not stacked on top of each other) within their shared day; the non-overlapping block on the other day spans its own full-width column; block colors differ by `type`; a block referencing a spot shows that spot's name.

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/\[tripId\]/plan/timeline-view.tsx src/app/trips/\[tripId\]/plan/page.tsx
git commit -m "feat: render timeline grid with overlap-aware block layout"
```

---

### Task 6: Block create/edit dialog + click wiring

**Files:**
- Create: `src/app/trips/[tripId]/plan/block-dialog.tsx`
- Modify: `src/app/trips/[tripId]/plan/timeline-view.tsx` (add `tripId` prop, click-to-create on empty grid area, click-to-edit on existing blocks, dialog state)
- Modify: `src/app/trips/[tripId]/plan/page.tsx` (pass the new `tripId` prop to `TimelineView`)

**Interfaces:**
- Consumes: `createBlock`, `updateBlock`, `deleteBlock`, `BlockInput` (Task 3); `PlanBlock`, `Spot`, `BlockType` types.
- Produces: `BlockDraft` type (`{ tripId: number; date: string; startTime: string; endTime: string }`), `BlockDialog` component — both scoped to this feature, not consumed by later tasks in this plan.

- [ ] **Step 1: Write `src/app/trips/[tripId]/plan/block-dialog.tsx`**

```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { createBlock, updateBlock, deleteBlock } from '@/lib/plan-blocks/actions'
import type { BlockType, PlanBlock, Spot } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const TYPE_OPTIONS: { value: BlockType; label: string }[] = [
  { value: 'spot', label: '스팟' },
  { value: 'transport', label: '이동' },
  { value: 'lodging', label: '숙소' },
  { value: 'memo', label: '자유 메모' },
]

export interface BlockDraft {
  tripId: number
  date: string
  startTime: string
  endTime: string
}

function toDbTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value
}

export function BlockDialog({
  open,
  onOpenChange,
  draft,
  editingBlock,
  spots,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: BlockDraft | null
  editingBlock: PlanBlock | null
  spots: Spot[]
}) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<BlockType>('spot')
  const [spotId, setSpotId] = useState<string>('none')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (editingBlock) {
      setTitle(editingBlock.title)
      setType(editingBlock.type)
      setSpotId(editingBlock.spot_id ? String(editingBlock.spot_id) : 'none')
      setDate(editingBlock.date)
      setStartTime(editingBlock.start_time.slice(0, 5))
      setEndTime(editingBlock.end_time.slice(0, 5))
      setMemo(editingBlock.memo ?? '')
    } else if (draft) {
      setTitle('')
      setType('spot')
      setSpotId('none')
      setDate(draft.date)
      setStartTime(draft.startTime)
      setEndTime(draft.endTime)
      setMemo('')
    }
    setError(null)
  }, [editingBlock, draft])

  const tripId = editingBlock?.trip_id ?? draft?.tripId
  if (!tripId) return null

  const submit = () => {
    startTransition(async () => {
      const input = {
        tripId,
        date,
        startTime: toDbTime(startTime),
        endTime: toDbTime(endTime),
        type,
        spotId: type === 'spot' && spotId !== 'none' ? Number(spotId) : null,
        title,
        memo,
      }

      const result = editingBlock
        ? await updateBlock(editingBlock.id, tripId, input)
        : await createBlock(input)

      if (result.error) {
        setError(result.error)
      } else {
        onOpenChange(false)
      }
    })
  }

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingBlock ? '일정 수정' : '일정 추가'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">제목</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 두오모 투어" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">유형</label>
            <Select value={type} onValueChange={(value) => setType(value as BlockType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {type === 'spot' && (
            <div>
              <label className="mb-1 block text-sm font-medium">장소</label>
              <Select value={spotId} onValueChange={setSpotId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">연결 안 함</SelectItem>
                  {spots.map((spot) => (
                    <SelectItem key={spot.id} value={String(spot.id)}>
                      {spot.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium">날짜</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium">시작</label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium">종료</label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">메모</label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          {editingBlock && (
            <Button variant="destructive" onClick={remove} disabled={isPending}>
              삭제
            </Button>
          )}
          <Button onClick={submit} disabled={isPending}>
            {isPending ? '저장하는 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Add click wiring to `src/app/trips/[tripId]/plan/timeline-view.tsx`**

Add these two functions right after `layoutDayBlocks` (before the `TimelineView` export):

```ts
function pxToTime(px: number): string {
  const totalMinutes = Math.round(px / PX_PER_SLOT) * SLOT_MINUTES
  const clamped = Math.max(0, Math.min(totalMinutes, 24 * 60 - SLOT_MINUTES))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function addMinutesToTime(time: string, minutesToAdd: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = Math.min(h * 60 + m + minutesToAdd, 24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
```

Add this import at the top of the file:

```ts
import { useState } from 'react'
import { BlockDialog, type BlockDraft } from './block-dialog'
```

Change the `TimelineView` function signature from:

```tsx
export function TimelineView({
  startDate,
  endDate,
  blocks,
  spots,
}: {
  startDate: string
  endDate: string
  blocks: PlanBlock[]
  spots: Spot[]
}) {
```

to:

```tsx
export function TimelineView({
  tripId,
  startDate,
  endDate,
  blocks,
  spots,
}: {
  tripId: number
  startDate: string
  endDate: string
  blocks: PlanBlock[]
  spots: Spot[]
}) {
```

Right after the existing `const dayHeight = SLOTS_PER_DAY * PX_PER_SLOT` line, add:

```tsx
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<BlockDraft | null>(null)
  const [editingBlock, setEditingBlock] = useState<PlanBlock | null>(null)

  const openCreateDialog = (date: string, event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const offsetY = event.clientY - rect.top
    const startTime = pxToTime(offsetY)
    setDraft({ tripId, date, startTime, endTime: addMinutesToTime(startTime, 60) })
    setEditingBlock(null)
    setDialogOpen(true)
  }

  const openEditDialog = (block: PlanBlock, event: React.MouseEvent) => {
    event.stopPropagation()
    setEditingBlock(block)
    setDraft(null)
    setDialogOpen(true)
  }
```

Change the day-column's grid `<div>` from:

```tsx
            <div
              className="relative"
              style={{
                height: dayHeight,
                backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${PX_PER_SLOT}px)`,
              }}
            >
```

to:

```tsx
            <div
              className="relative cursor-pointer"
              style={{
                height: dayHeight,
                backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${PX_PER_SLOT}px)`,
              }}
              onClick={(event) => openCreateDialog(date, event)}
            >
```

Add an `onClick` to each block's `<div>` — change:

```tsx
                  <div
                    key={block.id}
                    className={`absolute overflow-hidden rounded border p-1 text-xs ${TYPE_COLORS[block.type]}`}
                    style={{
                      top,
                      height,
                      left: `${block.column * widthPercent}%`,
                      width: `${widthPercent}%`,
                    }}
                  >
```

to:

```tsx
                  <div
                    key={block.id}
                    className={`absolute overflow-hidden rounded border p-1 text-xs ${TYPE_COLORS[block.type]}`}
                    style={{
                      top,
                      height,
                      left: `${block.column * widthPercent}%`,
                      width: `${widthPercent}%`,
                    }}
                    onClick={(event) => openEditDialog(block, event)}
                  >
```

Finally, right before the closing `</div>` of the outer `<div className="flex overflow-x-auto ...">` wrapper, add the dialog and close the returned fragment. Change the end of the function from:

```tsx
        )
      })}
    </div>
  )
}
```

to:

```tsx
        )
      })}
      </div>

      <BlockDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        draft={draft}
        editingBlock={editingBlock}
        spots={spots}
      />
    </>
  )
}
```

...and change the function's `return (` line from `return (\n    <div className="flex overflow-x-auto rounded-lg border">` to `return (\n    <>\n    <div className="flex overflow-x-auto rounded-lg border">` (wrapping the existing grid in a fragment so the dialog can be a sibling). Run the formatter/linter after this edit (`pnpm lint`) rather than hand-matching indentation — the exact whitespace doesn't matter, the JSX structure (fragment wrapping the grid div and the dialog as siblings) does.

- [ ] **Step 3: Pass `tripId` from `src/app/trips/[tripId]/plan/page.tsx`**

Change:

```tsx
        <TimelineView startDate={trip.start_date} endDate={trip.end_date} blocks={blocks} spots={spots} />
```

to:

```tsx
        <TimelineView
          tripId={numericTripId}
          startDate={trip.start_date}
          endDate={trip.end_date}
          blocks={blocks}
          spots={spots}
        />
```

- [ ] **Step 4: Manual end-to-end verification**

Run: `pnpm build` (catches any JSX structure mistakes from Step 2's fragment wrapping), then `pnpm dev`. As a logged-in trip member on `/trips/<id>/plan`:
1. Click an empty area of a day column — confirm the create dialog opens with 날짜 pre-filled to that column's date and 시작/종료 pre-filled to roughly the clicked time (±30분, snapped) and a 1-hour default duration.
2. Fill in a title, leave type as 스팟, pick a spot from the 장소 dropdown (one created in Task 4's verification), save — confirm the block appears on the grid at the right time, and check the 장소 패널 (re-fetch via reload if needed) shows that spot's status flipped to "배치됨".
3. Click the newly-created block — confirm the edit dialog opens pre-filled with its exact data. Change its title and time range, save — confirm the block updates and moves on the grid.
4. Click the block again, click 삭제 — confirm it disappears from the grid.
5. Try creating a block with an empty title — confirm the inline Korean validation error appears and nothing is created, dialog stays open.

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/\[tripId\]/plan/block-dialog.tsx src/app/trips/\[tripId\]/plan/timeline-view.tsx src/app/trips/\[tripId\]/plan/page.tsx
git commit -m "feat: add click-to-create/edit block dialog wired to the timeline"
```

---

## Definition of done for M2 Timeline Foundation

- [ ] `pnpm test` passes (existing M1 suite + this plan's new validation tests).
- [ ] `pnpm build` succeeds with no type errors.
- [ ] Manual walkthrough (Task 6 Step 4) completed with a real trip member account.
- [ ] All 6 tasks committed individually (not squashed).
- [ ] Known deliberate gaps (F5 map view, drag interactions, undo toast, travel-time hints, Google Places search, bookmark import into spots, spot edit/delete, mobile layout — see Global Constraints) are captured as follow-up work, not forgotten.
