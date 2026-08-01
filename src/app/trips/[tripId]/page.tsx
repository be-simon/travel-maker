import { notFound } from 'next/navigation'
import { getTrip, listTripMembers } from '@/lib/trips/queries'
import { InviteForm } from './invite-form'

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  const numericTripId = Number(tripId)
  if (!Number.isInteger(numericTripId)) notFound()

  const trip = await getTrip(numericTripId)
  if (!trip) notFound()

  const members = await listTripMembers(trip.id)

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">{trip.title}</h1>
        <p className="text-sm text-muted-foreground">
          {trip.start_date} – {trip.end_date}
        </p>
      </header>

      <nav className="mb-6 flex gap-4 border-b pb-2 text-sm">
        <span className="font-medium">멤버</span>
        <span className="text-muted-foreground">플랜 (M2에서 제공)</span>
        <span className="text-muted-foreground">Today (M3에서 제공)</span>
      </nav>

      <section className="space-y-4">
        <ul className="space-y-2">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between rounded-lg border p-3">
              <span>{member.invited_email}</span>
              <span className="flex gap-2 text-xs">
                <span className="rounded-full bg-secondary px-2 py-0.5">
                  {member.role === 'owner' ? '오너' : '에디터'}
                </span>
                <span className="rounded-full bg-secondary px-2 py-0.5">
                  {member.status === 'active' ? '참여중' : '초대중'}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <InviteForm tripId={trip.id} />
      </section>
    </main>
  )
}
