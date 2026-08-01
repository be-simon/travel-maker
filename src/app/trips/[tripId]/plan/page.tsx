import { notFound } from 'next/navigation'
import { listSpotsByTrip, listSpotGroupsByTrip } from '@/lib/spots/queries'
import { SpotPanel } from './spot-panel'

export default async function PlanPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  if (!/^\d+$/.test(tripId)) notFound()
  const numericTripId = Number(tripId)

  const [spots, groups] = await Promise.all([
    listSpotsByTrip(numericTripId),
    listSpotGroupsByTrip(numericTripId),
  ])

  return (
    <div className="flex gap-6">
      <aside className="w-72 shrink-0">
        <SpotPanel tripId={numericTripId} spots={spots} groups={groups} />
      </aside>
      <section className="flex-1 rounded-lg border p-6 text-sm text-muted-foreground">
        타임라인은 곧 제공됩니다.
      </section>
    </div>
  )
}
