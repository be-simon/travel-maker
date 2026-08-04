import { notFound } from 'next/navigation'
import { getTrip } from '@/lib/trips/queries'
import { listSpotsByTrip, listSpotGroupsByTrip } from '@/lib/spots/queries'
import { listBlocksByTrip } from '@/lib/plan-blocks/queries'
import { listMyBookmarks } from '@/lib/bookmarks/queries'
import { MapProvider } from '@/components/map/map-provider'
import { SpotPanel } from './spot-panel'
import { PlanCanvas } from './plan-canvas'

export default async function PlanPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  if (!/^\d+$/.test(tripId)) notFound()
  const numericTripId = Number(tripId)

  const trip = await getTrip(numericTripId)
  if (!trip) notFound()

  const [spots, groups, blocks, bookmarks] = await Promise.all([
    listSpotsByTrip(numericTripId),
    listSpotGroupsByTrip(numericTripId),
    listBlocksByTrip(numericTripId),
    listMyBookmarks(),
  ])

  return (
    <MapProvider>
      <div className="flex flex-col gap-6 md:flex-row">
        <aside className="w-full shrink-0 md:w-72">
          <SpotPanel tripId={numericTripId} spots={spots} groups={groups} bookmarks={bookmarks} />
        </aside>
        <section className="flex-1">
          <PlanCanvas
            tripId={numericTripId}
            startDate={trip.start_date}
            endDate={trip.end_date}
            blocks={blocks}
            spots={spots}
            groups={groups}
          />
        </section>
      </div>
    </MapProvider>
  )
}
