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
