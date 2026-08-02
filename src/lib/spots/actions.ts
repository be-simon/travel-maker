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
  placeId: string | null
  lat: number | null
  lng: number | null
  address: string | null
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
    place_id: input.placeId,
    lat: input.lat,
    lng: input.lng,
    address: input.address,
  })

  if (error) {
    console.error('createSpot failed:', error)
    return { error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  revalidatePath(`/trips/${input.tripId}/plan`)
  return { error: null }
}
