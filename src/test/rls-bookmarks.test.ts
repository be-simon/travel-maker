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
