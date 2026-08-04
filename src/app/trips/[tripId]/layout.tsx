import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTrip, listTripMembers } from '@/lib/trips/queries'
import { TripRealtimeProvider, PresenceAvatars } from '@/lib/realtime/trip-realtime'
import { TripNav } from './trip-nav'

export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tripId: string }>
}) {
  const { tripId } = await params
  if (!/^\d+$/.test(tripId)) notFound()
  const numericTripId = Number(tripId)

  const trip = await getTrip(numericTripId)
  if (!trip) notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const members = await listTripMembers(trip.id)
  const memberEmailsByUserId = Object.fromEntries(
    members
      .filter((member) => member.user_id != null)
      .map((member) => [member.user_id as string, member.invited_email])
  )

  return (
    <TripRealtimeProvider
      tripId={trip.id}
      userId={user.id}
      userEmail={user.email ?? ''}
      memberEmailsByUserId={memberEmailsByUserId}
    >
      <main className="mx-auto max-w-5xl p-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{trip.title}</h1>
            <p className="text-sm text-muted-foreground">
              {trip.start_date} – {trip.end_date}
            </p>
          </div>
          <PresenceAvatars />
        </header>

        <TripNav tripId={trip.id} />

        {children}
      </main>
    </TripRealtimeProvider>
  )
}
