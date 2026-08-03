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
    // 23505 = unique 위반(bookmarks_owner_place_uniq): 같은 place를 이미 저장함.
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
