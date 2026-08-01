# M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Google-OAuth-gated Next.js app where a user can create a trip workspace, invite a companion by email, and have that companion accept and see the trip — i.e. F1 (인증) + F2 (여행 워크스페이스) from `docs/PRD.md`, end to end.

**Architecture:** Next.js 16 App Router (Server Components + Server Actions) talking directly to Supabase Postgres through Row Level Security — no custom API layer. Mutations are Server Actions in `src/lib/trips/actions.ts`; reads are plain `async` query functions in `src/lib/trips/queries.ts` called from Server Components.

**Tech Stack:** Next.js 16 (TS, App Router, Tailwind v4), shadcn/ui, `@supabase/ssr` + `@supabase/supabase-js`, Vitest.

## Global Constraints

- Package manager is **pnpm** — every install/run command uses `pnpm`, not `npm`/`yarn`.
- All user-facing copy is **Korean**, matching `docs/PRD.md` / `docs/prototype.html` terminology exactly (e.g. "여행", "저장한 장소", "여행 중"). Do not translate to English.
- Never instantiate a Supabase client ad hoc — always go through `src/lib/supabase/client.ts` (browser) or `src/lib/supabase/server.ts` (Server Components/Actions/Route Handlers), built in Task 2.
- The DB schema is **already migrated and verified** — `supabase/migrations/20260801000000_initial_schema.sql` (trips, trip_members, bookmarks, spot_groups, spots + RLS). Do not modify it in this plan; if a task appears to need a schema change, stop and flag it instead of editing the migration.
- Local Supabase runs on shifted ports (see `supabase/config.toml`: API `54331`, DB `54332`, Studio `54333`) — another, unrelated Supabase project already occupies the defaults on this machine. Run `supabase start` (or `supabase status` if already running) to get the local `ANON_KEY`/`API_URL` before Task 1.
- **F3 (저장한 장소) is out of scope for this plan.** The trip-creation wizard's country/city bookmark-import step does not exist yet — Task 7 ships a real, correctly-worded "coming soon" message there instead of building UI against a feature with zero data. A follow-up plan adds bookmarks and wires real import into this same step.
- **Trip edit/delete is out of scope for this plan.** PRD F2 says workspaces can be "생성/수정/삭제"; this plan only ships create (Task 7). Edit/delete are pure CRUD on a schema that already exists (`trips_update`/`trips_delete` RLS policies are already live) — low risk to add later, deliberately cut here to keep Task 7/8 reviewable. Track as a fast-follow task, not a silent gap.
- **Proactive invite email ("초대 링크 발송") is out of scope for this plan.** PRD F2 describes inviting by email → an invite link is sent → the invitee joins by logging in with the matching Google account. This plan implements the DB-level half (a `pending` `trip_members` row, visible to the invitee as "받은 초대" on `/home` once they happen to log in) but does not send an email. Doing so via Supabase Auth's `admin.inviteUserByEmail` interacts with this app's Google-OAuth-only login in a way that needs dedicated verification first — specifically, whether an account created via that invite flow auto-links to the same person's later "Google로 로그인" by matching email, or ends up as a second, disconnected `auth.users` row. That verification requires real Google OAuth credentials and a real inbox, neither available while building this plan — resolve it as a focused fast-follow task, not by guessing at the linking behavior now.
- Visual polish matching `docs/prototype.html`'s custom design tokens is **not** required this round — use shadcn/ui defaults + Tailwind utility classes. Functional correctness first; a later pass reconciles visuals.
- Every Server Action returns `{ error: string | null }` (see `ActionResult` in Task 5) rather than throwing, except `createTrip`, which redirects on success.

---

### Task 1: Test infrastructure — Vitest + local Supabase test helpers

**Files:**
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/test/supabase-test-helpers.ts`
- Modify: `package.json` (add `test`/`test:watch` scripts)
- Create: `.env.test.local` (gitignored — already covered by `.env*` in `.gitignore`)

**Interfaces:**
- Produces: `serviceClient()`, `createTestUser(email: string): Promise<{ user: User; password: string }>`, `signInAsClient(email: string, password: string): Promise<SupabaseClient>`, `deleteTestUser(userId: string): Promise<void>` from `src/test/supabase-test-helpers.ts` — used by Task 3's RLS test and any later integration test.

- [ ] **Step 1: Install test dependencies**

```bash
pnpm add -D vitest dotenv
```

- [ ] **Step 2: Get local Supabase credentials and write `.env.test.local`**

```bash
supabase status -o env
```

Copy `API_URL` → `NEXT_PUBLIC_SUPABASE_URL`, `ANON_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SERVICE_ROLE_KEY` → `SUPABASE_SERVICE_ROLE_KEY` into `.env.test.local`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from supabase status>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from supabase status>
```

Also copy the same three values into `.env.local` (used by `pnpm dev`) so the app itself can reach local Supabase.

- [ ] **Step 3: Write `src/test/setup.ts`**

```ts
import { config } from 'dotenv'

config({ path: '.env.test.local' })
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

- [ ] **Step 5: Write `src/test/supabase-test-helpers.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export function serviceClient(): SupabaseClient {
  return createClient(url, serviceKey)
}

const TEST_PASSWORD = 'test-password-123!'

export async function createTestUser(email: string) {
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  })
  if (error) throw error
  return { user: data.user!, password: TEST_PASSWORD }
}

export async function signInAsClient(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(url, anonKey)
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return client
}

export async function deleteTestUser(userId: string) {
  await serviceClient().auth.admin.deleteUser(userId)
}
```

- [ ] **Step 6: Add scripts to `package.json`**

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 7: Verify setup with a throwaway smoke test**

Create `src/test/smoke.test.ts` temporarily:

```ts
import { describe, it, expect } from 'vitest'
import { createTestUser, deleteTestUser } from './supabase-test-helpers'

describe('smoke', () => {
  it('can create and delete a test user against local Supabase', async () => {
    const { user } = await createTestUser(`smoke-${Date.now()}@example.com`)
    expect(user.id).toBeTruthy()
    await deleteTestUser(user.id)
  })
})
```

Run: `pnpm test`
Expected: 1 passed. Delete `src/test/smoke.test.ts` afterward — it was only to prove the harness works; Task 3 provides the real coverage.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts src/test/setup.ts src/test/supabase-test-helpers.ts package.json pnpm-lock.yaml
git commit -m "test: add Vitest + local Supabase integration test harness"
```

(`.env.test.local` and `.env.local` are gitignored — do not add them.)

---

### Task 2: Supabase client helpers + DB types + auth-gating middleware

**Files:**
- Create: `src/types/database.ts`
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/middleware.ts`
- Create: `middleware.ts` (repo root, alongside `next.config.ts`)

**Interfaces:**
- Produces: `createClient()` (browser, sync) from `src/lib/supabase/client.ts`; `createClient()` (server, `async`) from `src/lib/supabase/server.ts` — both used by every later task that touches Supabase.
- Produces: `Trip`, `TripMember`, `Bookmark`, `SpotGroup`, `Spot` interfaces from `src/types/database.ts`, matching `supabase/migrations/20260801000000_initial_schema.sql` column-for-column — used by Task 5's queries/actions.

- [ ] **Step 1: Write `src/types/database.ts`**

```ts
export type TripRole = 'owner' | 'editor'
export type TripMemberStatus = 'pending' | 'active'
export type SpotCategory = 'sight' | 'restaurant' | 'cafe' | 'shopping' | 'lodging' | 'etc'
export type SpotStatus = 'candidate' | 'planned' | 'visited'
export type BookmarkSource = 'manual' | 'gmap_link' | 'ocr'

export interface Trip {
  id: number
  title: string
  start_date: string
  end_date: string
  owner_id: string
  created_at: string
  updated_at: string
}

export interface TripMember {
  id: number
  trip_id: number
  user_id: string | null
  invited_email: string
  role: TripRole
  status: TripMemberStatus
  created_at: string
}

export interface Bookmark {
  id: number
  owner_id: string
  name: string
  category: SpotCategory
  country: string | null
  city: string | null
  place_id: string | null
  lat: number | null
  lng: number | null
  address: string | null
  memo: string | null
  source: BookmarkSource
  created_at: string
}

export interface SpotGroup {
  id: number
  trip_id: number
  name: string
  sort_order: number
}

export interface Spot {
  id: number
  trip_id: number
  group_id: number | null
  bookmark_id: number | null
  name: string
  category: SpotCategory
  place_id: string | null
  lat: number | null
  lng: number | null
  address: string | null
  memo: string | null
  priority: boolean
  est_cost: number | null
  link: string | null
  status: SpotStatus
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2: Write `src/lib/supabase/client.ts`**

```ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 3: Write `src/lib/supabase/server.ts`**

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — middleware.ts refreshes the
            // session on the next request instead. Safe to ignore here.
          }
        },
      },
    }
  )
}
```

- [ ] **Step 4: Write `src/lib/supabase/middleware.ts`**

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/auth']

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isPublicPath = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p))

  if (!user && !isPublicPath && request.nextUrl.pathname !== '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
```

- [ ] **Step 5: Write `middleware.ts`**

```ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

- [ ] **Step 6: Verify it type-checks and builds**

Run: `pnpm build`
Expected: succeeds (no routes use these yet, so this only checks types/imports resolve).

- [ ] **Step 7: Commit**

```bash
git add src/types/database.ts src/lib/supabase middleware.ts
git commit -m "feat: add Supabase client/server helpers, DB types, auth-gating middleware"
```

---

### Task 3: RLS regression test

Formalizes the manual verification already run by hand against this schema (create → isolate → invite → accept → roster-visibility) into an automated test, so a future migration can't silently break it.

**Files:**
- Create: `src/test/rls-trips.test.ts`

**Interfaces:**
- Consumes: `serviceClient`, `createTestUser`, `signInAsClient`, `deleteTestUser` from `src/test/supabase-test-helpers.ts` (Task 1).

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { createTestUser, signInAsClient, deleteTestUser } from './supabase-test-helpers'

describe('trips RLS', () => {
  const createdUserIds: string[] = []

  afterAll(async () => {
    await Promise.all(createdUserIds.map(deleteTestUser))
  })

  it('owner can create and see a trip; a stranger cannot', async () => {
    const owner = await createTestUser(`owner-${Date.now()}@example.com`)
    const stranger = await createTestUser(`stranger-${Date.now()}@example.com`)
    createdUserIds.push(owner.user.id, stranger.user.id)

    const ownerClient = await signInAsClient(owner.user.email!, owner.password)
    const strangerClient = await signInAsClient(stranger.user.email!, stranger.password)

    const { data: trip, error: insertError } = await ownerClient
      .from('trips')
      .insert({
        title: 'Italy',
        start_date: '2026-05-11',
        end_date: '2026-05-23',
        owner_id: owner.user.id,
      })
      .select()
      .single()

    expect(insertError).toBeNull()
    expect(trip?.title).toBe('Italy')

    const { data: strangerView } = await strangerClient.from('trips').select().eq('id', trip!.id)
    expect(strangerView).toEqual([])
  })

  it('trip owner is auto-added to trip_members as an active owner', async () => {
    const owner = await createTestUser(`owner-${Date.now()}@example.com`)
    createdUserIds.push(owner.user.id)
    const ownerClient = await signInAsClient(owner.user.email!, owner.password)

    const { data: trip } = await ownerClient
      .from('trips')
      .insert({ title: 'Japan', start_date: '2026-09-01', end_date: '2026-09-07', owner_id: owner.user.id })
      .select()
      .single()

    const { data: members } = await ownerClient.from('trip_members').select().eq('trip_id', trip!.id)
    expect(members).toHaveLength(1)
    expect(members![0]).toMatchObject({ role: 'owner', status: 'active', user_id: owner.user.id })
  })

  it('invited member sees the trip only after accepting, and a stranger cannot self-insert membership', async () => {
    const owner = await createTestUser(`owner-${Date.now()}@example.com`)
    const invitee = await createTestUser(`invitee-${Date.now()}@example.com`)
    const stranger = await createTestUser(`stranger2-${Date.now()}@example.com`)
    createdUserIds.push(owner.user.id, invitee.user.id, stranger.user.id)

    const ownerClient = await signInAsClient(owner.user.email!, owner.password)
    const inviteeClient = await signInAsClient(invitee.user.email!, invitee.password)
    const strangerClient = await signInAsClient(stranger.user.email!, stranger.password)

    const { data: trip } = await ownerClient
      .from('trips')
      .insert({ title: 'Spain', start_date: '2026-10-01', end_date: '2026-10-05', owner_id: owner.user.id })
      .select()
      .single()

    await ownerClient.from('trip_members').insert({
      trip_id: trip!.id,
      invited_email: invitee.user.email!,
      role: 'editor',
      status: 'pending',
    })

    const { data: beforeAccept } = await inviteeClient.from('trips').select().eq('id', trip!.id)
    expect(beforeAccept).toEqual([])

    const { error: acceptError } = await inviteeClient.rpc('accept_trip_invite', { p_trip_id: trip!.id })
    expect(acceptError).toBeNull()

    const { data: afterAccept } = await inviteeClient.from('trips').select().eq('id', trip!.id)
    expect(afterAccept).toHaveLength(1)

    const { error: strangerInsertError } = await strangerClient.from('trip_members').insert({
      trip_id: trip!.id,
      invited_email: stranger.user.email!,
      role: 'owner',
      status: 'active',
    })
    expect(strangerInsertError).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run and confirm all three pass**

Run: `pnpm test`
Expected: 3 passed (all in `rls-trips.test.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/test/rls-trips.test.ts
git commit -m "test: add RLS regression coverage for trips/trip_members/accept_trip_invite"
```

---

### Task 4: Google OAuth login / callback / signout

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/app/login/login-button.tsx`
- Create: `src/app/auth/callback/route.ts`
- Create: `src/app/auth/signout/route.ts`
- Modify: `src/app/page.tsx` (redirect to `/login` or `/home` based on session)

**Interfaces:**
- Consumes: `createClient()` (browser + server) from Task 2.
- Produces: `/login`, `/auth/callback`, `/auth/signout` routes — consumed by Task 6's home page (sign-out link) and by `middleware.ts`'s redirect target.

**Setup this task depends on (do first, not part of the app code):** In the Supabase Studio at `http://127.0.0.1:54333` → Authentication → Providers, enable Google and fill in a Google OAuth Client ID/Secret (create one in Google Cloud Console with an OAuth consent screen, authorized redirect URI `http://127.0.0.1:54331/auth/v1/callback`). This is a one-time manual dashboard step — there is no CLI/migration path for it locally.

- [ ] **Step 1: Write `src/app/login/login-button.tsx`**

```tsx
'use client'

import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export function LoginButton() {
  const handleLogin = async () => {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  return <Button onClick={handleLogin}>Google로 로그인</Button>
}
```

- [ ] **Step 2: Write `src/app/login/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginButton } from './login-button'

export default async function LoginPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (data.user) redirect('/home')

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-semibold">Travel Maker</h1>
      <p className="text-muted-foreground">Google 계정으로 로그인하세요.</p>
      <LoginButton />
    </main>
  )
}
```

- [ ] **Step 3: Write `src/app/auth/callback/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/home'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login`)
}
```

- [ ] **Step 4: Write `src/app/auth/signout/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.url))
}
```

- [ ] **Step 5: Rewrite `src/app/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function RootPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  redirect(data.user ? '/home' : '/login')
}
```

- [ ] **Step 6: Manual verification (no automated test — this is a real external OAuth round trip)**

Run: `pnpm dev`, open `http://localhost:3000`.
Expected: redirected to `/login`; clicking "Google로 로그인" completes Google's consent screen and lands on `/home` (a 404 is fine at this point — Task 6 builds `/home` — the important thing is the redirect chain completes and a Supabase session cookie is set). Confirm via `document.cookie` in devtools that `sb-*` cookies exist, or check Supabase Studio → Authentication → Users for the new row.

- [ ] **Step 7: Commit**

```bash
git add src/app/login src/app/auth src/app/page.tsx
git commit -m "feat: add Google OAuth login/callback/signout flow"
```

---

### Task 5: Trip data layer — validation, queries, Server Actions

**Files:**
- Create: `src/lib/trips/validation.ts`
- Create: `src/lib/trips/validation.test.ts`
- Create: `src/lib/trips/queries.ts`
- Create: `src/lib/trips/actions.ts`

**Interfaces:**
- Produces: `validateTripDates(startDate: string, endDate: string): string | null` — used by `actions.ts` below (server-side) and by Task 7's wizard for inline client-side validation before submit.
- Produces: `validateInviteEmail(email: string): string | null` — used by `actions.ts`'s `inviteMember` only; Task 8's invite form relies on that server-side check rather than duplicating it inline.
- Produces: `listMyTrips(): Promise<Trip[]>`, `listPendingInvites(): Promise<(TripMember & { trip: Trip })[]>`, `getTrip(tripId: number): Promise<Trip | null>`, `listTripMembers(tripId: number): Promise<TripMember[]>` — used by Task 6 and Task 8.
- Produces: `ActionResult` (`{ error: string | null }`), `createTrip(input: { title: string; startDate: string; endDate: string }): Promise<ActionResult>`, `inviteMember(tripId: number, email: string): Promise<ActionResult>`, `acceptInvite(tripId: number): Promise<ActionResult>` — used by Task 6, 7, 8's client components.

- [ ] **Step 1: Write the failing test for validation**

```ts
// src/lib/trips/validation.test.ts
import { describe, it, expect } from 'vitest'
import { validateTripDates, validateInviteEmail } from './validation'

describe('validateTripDates', () => {
  it('rejects an end date before the start date', () => {
    expect(validateTripDates('2026-05-20', '2026-05-11')).toBe(
      '종료일은 시작일보다 빠를 수 없습니다.'
    )
  })

  it('rejects missing dates', () => {
    expect(validateTripDates('', '2026-05-11')).toBe('시작일과 종료일을 입력해 주세요.')
  })

  it('accepts a valid range', () => {
    expect(validateTripDates('2026-05-11', '2026-05-23')).toBeNull()
  })

  it('accepts a single-day trip', () => {
    expect(validateTripDates('2026-05-11', '2026-05-11')).toBeNull()
  })
})

describe('validateInviteEmail', () => {
  it('rejects an obviously invalid email', () => {
    expect(validateInviteEmail('not-an-email')).toBe('올바른 이메일 형식이 아닙니다.')
  })

  it('accepts a valid email', () => {
    expect(validateInviteEmail('friend@example.com')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/trips/validation.test.ts`
Expected: FAIL — `Cannot find module './validation'`.

- [ ] **Step 3: Write `src/lib/trips/validation.ts`**

```ts
export function validateTripDates(startDate: string, endDate: string): string | null {
  if (!startDate || !endDate) return '시작일과 종료일을 입력해 주세요.'
  if (endDate < startDate) return '종료일은 시작일보다 빠를 수 없습니다.'
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateInviteEmail(email: string): string | null {
  if (!EMAIL_RE.test(email)) return '올바른 이메일 형식이 아닙니다.'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/trips/validation.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Write `src/lib/trips/queries.ts`**

```ts
import { createClient } from '@/lib/supabase/server'
import type { Trip, TripMember } from '@/types/database'

export async function listMyTrips(): Promise<Trip[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('trips').select('*').order('start_date', { ascending: true })
  if (error) throw error
  return data
}

export async function listPendingInvites(): Promise<(TripMember & { trip: Trip })[]> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const email = userData.user?.email
  if (!email) return []

  const { data, error } = await supabase
    .from('trip_members')
    .select('*, trip:trips(*)')
    .eq('invited_email', email)
    .eq('status', 'pending')
  if (error) throw error
  return data as unknown as (TripMember & { trip: Trip })[]
}

export async function getTrip(tripId: number): Promise<Trip | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).maybeSingle()
  if (error) throw error
  return data
}

export async function listTripMembers(tripId: number): Promise<TripMember[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('trip_members')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}
```

- [ ] **Step 6: Write `src/lib/trips/actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { validateTripDates, validateInviteEmail } from './validation'

export interface ActionResult {
  error: string | null
}

export async function createTrip(input: {
  title: string
  startDate: string
  endDate: string
}): Promise<ActionResult> {
  const dateError = validateTripDates(input.startDate, input.endDate)
  if (dateError) return { error: dateError }
  if (!input.title.trim()) return { error: '여행 이름을 입력해 주세요.' }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { error: '로그인이 필요합니다.' }

  const { data: trip, error } = await supabase
    .from('trips')
    .insert({
      title: input.title.trim(),
      start_date: input.startDate,
      end_date: input.endDate,
      owner_id: userData.user.id,
    })
    .select()
    .single()

  if (error) return { error: error.message }

  revalidatePath('/home')
  redirect(`/trips/${trip.id}`)
}

export async function inviteMember(tripId: number, email: string): Promise<ActionResult> {
  const emailError = validateInviteEmail(email)
  if (emailError) return { error: emailError }

  const supabase = await createClient()
  const { error } = await supabase.from('trip_members').insert({
    trip_id: tripId,
    invited_email: email.trim().toLowerCase(),
    role: 'editor',
    status: 'pending',
  })

  if (error) {
    if (error.code === '23505') return { error: '이미 초대된 이메일입니다.' }
    return { error: error.message }
  }

  revalidatePath(`/trips/${tripId}`)
  return { error: null }
}

export async function acceptInvite(tripId: number): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('accept_trip_invite', { p_trip_id: tripId })
  if (error) return { error: error.message }
  revalidatePath('/home')
  return { error: null }
}
```

- [ ] **Step 7: Type-check**

Run: `pnpm build`
Expected: succeeds. (`queries.ts`/`actions.ts` aren't imported by any page yet, so this only checks the files themselves are valid TypeScript — Tasks 6-8 wire them in.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/trips
git commit -m "feat: add trip validation, queries, and Server Actions"
```

---

### Task 6: Home screen — trip list + pending invites

**Files:**
- Create: `src/app/home/page.tsx`

**Interfaces:**
- Consumes: `listMyTrips`, `listPendingInvites` (Task 5 queries), `acceptInvite` (Task 5 action).

- [ ] **Step 1: Write `src/app/home/page.tsx`**

```tsx
import Link from 'next/link'
import { listMyTrips, listPendingInvites } from '@/lib/trips/queries'
import { acceptInvite } from '@/lib/trips/actions'
import { Button } from '@/components/ui/button'

function isTripInProgress(trip: { start_date: string; end_date: string }) {
  const today = new Date().toISOString().slice(0, 10)
  return trip.start_date <= today && today <= trip.end_date
}

export default async function HomePage() {
  const [trips, invites] = await Promise.all([listMyTrips(), listPendingInvites()])

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">내 여행</h1>
        <Button asChild>
          <Link href="/trips/new">+ 새 여행 만들기</Link>
        </Button>
      </div>

      {invites.length > 0 && (
        <section className="mb-8 space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">받은 초대</h2>
          {invites.map((invite) => (
            <form
              key={invite.id}
              action={async () => {
                'use server'
                await acceptInvite(invite.trip_id)
              }}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <span>{invite.trip.title}</span>
              <Button type="submit" variant="outline">
                참여하기
              </Button>
            </form>
          ))}
        </section>
      )}

      {trips.length === 0 ? (
        <p className="text-muted-foreground">아직 만든 여행이 없습니다.</p>
      ) : (
        <ul className="space-y-3">
          {trips.map((trip) => (
            <li key={trip.id}>
              <Link href={`/trips/${trip.id}`} className="block rounded-lg border p-4 hover:bg-accent">
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
                {isTripInProgress(trip) && (
                  <span className="mt-2 block text-sm text-emerald-700">지금 Today 모드 보기 →</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Manual verification**

Run: `pnpm dev`, log in (Task 4 flow), navigate to `/home`.
Expected: "아직 만든 여행이 없습니다." shown (no trips yet — Task 7 adds trip creation). No console errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/home
git commit -m "feat: add home screen with trip list and pending invites"
```

---

### Task 7: Trip creation wizard

**Files:**
- Create: `src/app/trips/new/page.tsx`
- Create: `src/app/trips/new/new-trip-wizard.tsx`

**Interfaces:**
- Consumes: `createTrip` (Task 5 action), `validateTripDates` (Task 5 validation).

- [ ] **Step 1: Add the shadcn Input component**

```bash
pnpm dlx shadcn@latest add input
```

Expected: creates `src/components/ui/input.tsx`.

- [ ] **Step 2: Write `src/app/trips/new/new-trip-wizard.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { createTrip } from '@/lib/trips/actions'
import { validateTripDates } from '@/lib/trips/validation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Step = 1 | 2

export function NewTripWizard() {
  const [step, setStep] = useState<Step>(1)
  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const goToStep2 = () => {
    if (!title.trim()) return setError('여행 이름을 입력해 주세요.')
    const dateError = validateTripDates(startDate, endDate)
    if (dateError) return setError(dateError)
    setError(null)
    setStep(2)
  }

  const submit = () => {
    startTransition(async () => {
      const result = await createTrip({ title, startDate, endDate })
      if (result.error) setError(result.error)
    })
  }

  if (step === 1) {
    return (
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">여행 이름</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 이탈리아 여행" />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">시작일</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">종료일</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button onClick={goToStep2}>다음</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-1 font-medium">저장한 장소 가져오기</h2>
        <p className="text-sm text-muted-foreground">
          국가·도시 기반 저장한 장소 가져오기는 다음 업데이트에서 제공됩니다. 지금은 빈 여행으로
          시작합니다.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep(1)}>
          이전
        </Button>
        <Button onClick={submit} disabled={isPending}>
          {isPending ? '만드는 중…' : '여행 만들기'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write `src/app/trips/new/page.tsx`**

```tsx
import { NewTripWizard } from './new-trip-wizard'

export default function NewTripPage() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-6 text-xl font-semibold">새 여행 만들기</h1>
      <NewTripWizard />
    </main>
  )
}
```

- [ ] **Step 4: Manual verification**

Run: `pnpm dev`, log in, go to `/home` → "+ 새 여행 만들기".
Expected: step 1 validates empty title / bad date range inline; step 2 shows the "다음 업데이트" message; "여행 만들기" creates the trip and redirects to `/trips/<id>` (404 expected until Task 8 — confirm instead via Supabase Studio → Table Editor → `trips` that the row exists with correct `owner_id`).

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/new src/components/ui/input.tsx package.json pnpm-lock.yaml
git commit -m "feat: add trip creation wizard"
```

---

### Task 8: Trip workspace shell — header, members list, invite form

**Files:**
- Create: `src/app/trips/[tripId]/page.tsx`
- Create: `src/app/trips/[tripId]/invite-form.tsx`

**Interfaces:**
- Consumes: `getTrip`, `listTripMembers` (Task 5 queries), `inviteMember` (Task 5 action).

- [ ] **Step 1: Write `src/app/trips/[tripId]/invite-form.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { inviteMember } from '@/lib/trips/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function InviteForm({ tripId }: { tripId: number }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const submit = () => {
    startTransition(async () => {
      const result = await inviteMember(tripId, email)
      if (result.error) {
        setError(result.error)
      } else {
        setError(null)
        setEmail('')
      }
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="초대할 Google 계정 이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button onClick={submit} disabled={isPending}>
          초대
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Write `src/app/trips/[tripId]/page.tsx`**

```tsx
import { notFound } from 'next/navigation'
import { getTrip, listTripMembers } from '@/lib/trips/queries'
import { InviteForm } from './invite-form'

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  const trip = await getTrip(Number(tripId))
  if (!trip) notFound()

  const members = await listTripMembers(trip.id)

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">{trip.title}</h1>
        <p className="text-sm text-muted-foreground">
          {trip.start_date} – {trip.end_date}
        </p>
      </header>

      <nav className="mb-6 flex gap-4 border-b pb-2 text-sm">
        <span className="font-medium">멤버</span>
        <span className="text-muted-foreground">플랜 (M2에서 제공)</span>
        <span className="text-muted-foreground">Today (M3에서 제공)</span>
      </nav>

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
        <InviteForm tripId={trip.id} />
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Manual end-to-end verification**

Run: `pnpm dev`. As the logged-in user: create a trip (Task 7), land on `/trips/<id>`, confirm the member list shows yourself as 오너/참여중. Invite a second Google account's email via the invite form; confirm the row appears as 에디터/초대중 immediately (no reload needed only if you re-navigate — Server Components re-fetch on navigation, that's expected, no live-push in M1). Log in as that second account (or use `supabase status` → Mailpit at `http://127.0.0.1:54334` if using email-link auth in local testing) and confirm it shows up under "받은 초대" on `/home`, and that accepting moves it into the main trip list and flips the badge to 참여중 on `/trips/<id>`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/trips/[tripId]"
git commit -m "feat: add trip workspace shell with member list and invite form"
```

---

## Definition of done for M1 Foundation

- [ ] `pnpm test` passes (validation unit tests + RLS integration tests).
- [ ] `pnpm build` succeeds with no type errors.
- [ ] Manual walkthrough (Task 8 Step 3) completed with two real Google accounts.
- [ ] All 8 tasks committed individually (not squashed) so review history stays legible.
- [ ] Known deliberate gaps (trip edit/delete, proactive invite email — see Global Constraints) are captured as follow-up work, not forgotten.
