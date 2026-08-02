import { notFound } from 'next/navigation'
import { getTrip } from '@/lib/trips/queries'
import { listSpotsByTrip, listSpotGroupsByTrip } from '@/lib/spots/queries'
import { listBlocksByTrip } from '@/lib/plan-blocks/queries'
import { SpotPanel } from './spot-panel'
import { TimelineView } from './timeline-view'

export default async function PlanPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  if (!/^\d+$/.test(tripId)) notFound()
  const numericTripId = Number(tripId)

  const trip = await getTrip(numericTripId)
  if (!trip) notFound()

  const [spots, groups, blocks] = await Promise.all([
    listSpotsByTrip(numericTripId),
    listSpotGroupsByTrip(numericTripId),
    listBlocksByTrip(numericTripId),
  ])

  return (
    <div className="flex gap-6">
      <aside className="w-72 shrink-0">
        <SpotPanel tripId={numericTripId} spots={spots} groups={groups} />
      </aside>
      <section className="flex-1">
        <TimelineView
          tripId={numericTripId}
          startDate={trip.start_date}
          endDate={trip.end_date}
          blocks={blocks}
          spots={spots}
        />
      </section>
    </div>
  )
}
