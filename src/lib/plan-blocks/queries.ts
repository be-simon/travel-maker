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
