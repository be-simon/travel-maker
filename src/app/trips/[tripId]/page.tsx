import { redirect } from 'next/navigation'

export default async function TripIndexPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  redirect(`/trips/${tripId}/members`)
}
