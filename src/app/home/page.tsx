import Link from 'next/link'
import { listMyTrips, listPendingInvites } from '@/lib/trips/queries'
import { acceptInvite } from '@/lib/trips/actions'
import { Button } from '@/components/ui/button'

function isTripInProgress(trip: { start_date: string; end_date: string }) {
  const today = new Date().toISOString().slice(0, 10)
  return trip.start_date <= today && today <= trip.end_date
}

export default async function HomePage() {
  const [trips, invites] = await Promise.all([listMyTrips(), listPendingInvites()])

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">내 여행</h1>
        <Button render={<Link href="/trips/new">+ 새 여행 만들기</Link>} />
      </div>

      {invites.length > 0 && (
        <section className="mb-8 space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">받은 초대</h2>
          {invites.map((invite) => (
            <form
              key={invite.id}
              action={async () => {
                'use server'
                await acceptInvite(invite.trip_id)
              }}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <span>{invite.trip?.title ?? '초대된 여행'}</span>
              <Button type="submit" variant="outline">
                참여하기
              </Button>
            </form>
          ))}
        </section>
      )}

      {trips.length === 0 ? (
        <p className="text-muted-foreground">아직 만든 여행이 없습니다.</p>
      ) : (
        <ul className="space-y-3">
          {trips.map((trip) => (
            <li key={trip.id}>
              <Link href={`/trips/${trip.id}`} className="block rounded-lg border p-4 hover:bg-accent">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{trip.title}</span>
                  {isTripInProgress(trip) && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                      여행 중
                    </span>
                  )}
                </div>
                <span className="text-sm text-muted-foreground">
                  {trip.start_date} – {trip.end_date}
                </span>
                {isTripInProgress(trip) && (
                  <span className="mt-2 block text-sm text-emerald-700">지금 Today 모드 보기 →</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
