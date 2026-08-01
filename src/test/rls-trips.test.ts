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

  it('invited member can see the trip while pending (to know what they were invited to), becomes an active member only after accepting, and a stranger cannot self-insert membership or see the trip at all', async () => {
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

    // Pending invitee can see the trip itself (so the "받은 초대" UI can show
    // what they're being invited to) via private.has_pending_invite(), but
    // is not yet an active member.
    const { data: beforeAccept } = await inviteeClient.from('trips').select().eq('id', trip!.id)
    expect(beforeAccept).toHaveLength(1)
    expect(beforeAccept![0].title).toBe('Spain')

    const { data: ownRowBeforeAccept } = await inviteeClient
      .from('trip_members')
      .select()
      .eq('trip_id', trip!.id)
      .eq('invited_email', invitee.user.email!)
      .single()
    expect(ownRowBeforeAccept?.status).toBe('pending')
    expect(ownRowBeforeAccept?.user_id).toBeNull()

    const { error: acceptError } = await inviteeClient.rpc('accept_trip_invite', { p_trip_id: trip!.id })
    expect(acceptError).toBeNull()

    const { data: afterAccept } = await inviteeClient.from('trips').select().eq('id', trip!.id)
    expect(afterAccept).toHaveLength(1)

    const { data: ownRowAfterAccept } = await inviteeClient
      .from('trip_members')
      .select()
      .eq('trip_id', trip!.id)
      .eq('invited_email', invitee.user.email!)
      .single()
    expect(ownRowAfterAccept?.status).toBe('active')
    expect(ownRowAfterAccept?.user_id).toBe(invitee.user.id)

    // A stranger with no invite at all never sees the trip, before or after
    // the invitee accepts, and cannot self-insert membership.
    const { data: strangerView } = await strangerClient.from('trips').select().eq('id', trip!.id)
    expect(strangerView).toEqual([])

    const { error: strangerInsertError } = await strangerClient.from('trip_members').insert({
      trip_id: trip!.id,
      invited_email: stranger.user.email!,
      role: 'owner',
      status: 'active',
    })
    expect(strangerInsertError).not.toBeNull()
  })

  it('an active editor cannot reassign owner_id to themselves (privilege escalation guard)', async () => {
    const owner = await createTestUser(`owner-${Date.now()}@example.com`)
    const editor = await createTestUser(`editor-${Date.now()}@example.com`)
    createdUserIds.push(owner.user.id, editor.user.id)

    const ownerClient = await signInAsClient(owner.user.email!, owner.password)
    const editorClient = await signInAsClient(editor.user.email!, editor.password)

    const { data: trip } = await ownerClient
      .from('trips')
      .insert({ title: 'France', start_date: '2026-11-01', end_date: '2026-11-05', owner_id: owner.user.id })
      .select()
      .single()

    await ownerClient.from('trip_members').insert({
      trip_id: trip!.id,
      invited_email: editor.user.email!,
      role: 'editor',
      status: 'pending',
    })
    const { error: acceptError } = await editorClient.rpc('accept_trip_invite', { p_trip_id: trip!.id })
    expect(acceptError).toBeNull()

    // The editor passes trips_update's USING clause (active member) and, before
    // the private.enforce_trip_owner_immutable() trigger, could also pass its
    // WITH CHECK by setting owner_id = auth.uid() — then DELETE (owner-only)
    // the trip out from under the real owner. The BEFORE UPDATE trigger must
    // reject this regardless of RLS.
    const { error: escalationError } = await editorClient
      .from('trips')
      .update({ owner_id: editor.user.id })
      .eq('id', trip!.id)
    expect(escalationError).not.toBeNull()

    const { data: stillOwnedByOwner } = await ownerClient.from('trips').select('owner_id').eq('id', trip!.id).single()
    expect(stillOwnedByOwner?.owner_id).toBe(owner.user.id)

    // Editors can still edit trip details (owner_id untouched) — must not regress F2.
    const { error: legitEditError } = await editorClient
      .from('trips')
      .update({ title: 'France (updated)' })
      .eq('id', trip!.id)
    expect(legitEditError).toBeNull()
  })
})
