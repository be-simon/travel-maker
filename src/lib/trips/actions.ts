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

  if (error) {
    console.error('createTrip failed:', error)
    return { error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

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
    console.error('inviteMember failed:', error)
    return { error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  revalidatePath(`/trips/${tripId}`)
  return { error: null }
}

export async function acceptInvite(tripId: number): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('accept_trip_invite', { p_trip_id: tripId })
  if (error) {
    console.error('acceptInvite failed:', error)
    return { error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
  revalidatePath('/home')
  return { error: null }
}
