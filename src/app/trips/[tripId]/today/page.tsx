import { notFound } from 'next/navigation'
import { getTrip } from '@/lib/trips/queries'
import { listSpotsByTrip } from '@/lib/spots/queries'
import { listBlocksByTrip } from '@/lib/plan-blocks/queries'
import { MapProvider } from '@/components/map/map-provider'
import { TodayView } from './today-view'

export default async function TodayPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  if (!/^\d+$/.test(tripId)) notFound()
  const numericTripId = Number(tripId)

  const trip = await getTrip(numericTripId)
  if (!trip) notFound()

  const [spots, blocks] = await Promise.all([
    listSpotsByTrip(numericTripId),
    listBlocksByTrip(numericTripId),
  ])

  return (
    <MapProvider>
      <TodayView trip={trip} spots={spots} blocks={blocks} />
    </MapProvider>
  )
}
