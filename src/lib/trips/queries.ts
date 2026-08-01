import { createClient } from '@/lib/supabase/server'
import type { Trip, TripMember } from '@/types/database'

export async function listMyTrips(): Promise<Trip[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('trips').select('*').order('start_date', { ascending: true })
  if (error) throw error
  return data
}

export async function listPendingInvites(): Promise<(TripMember & { trip: Trip | null })[]> {
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
  return data as unknown as (TripMember & { trip: Trip | null })[]
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
