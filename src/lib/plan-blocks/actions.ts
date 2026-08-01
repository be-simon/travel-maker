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
