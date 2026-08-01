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
