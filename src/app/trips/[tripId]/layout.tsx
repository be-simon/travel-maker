import { notFound } from 'next/navigation'
import { getTrip } from '@/lib/trips/queries'
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

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">{trip.title}</h1>
        <p className="text-sm text-muted-foreground">
          {trip.start_date} – {trip.end_date}
        </p>
      </header>

      <TripNav tripId={trip.id} />

      {children}
    </main>
  )
}
