'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function TripNav({ tripId }: { tripId: number }) {
  const pathname = usePathname()
  const isPlan = pathname?.startsWith(`/trips/${tripId}/plan`)
  const isMembers = pathname?.startsWith(`/trips/${tripId}/members`)

  return (
    <nav className="mb-6 flex gap-4 border-b pb-2 text-sm">
      <Link
        href={`/trips/${tripId}/plan`}
        className={isPlan ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}
      >
        플랜
      </Link>
      <Link
        href={`/trips/${tripId}/members`}
        className={isMembers ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}
      >
        멤버
      </Link>
      <span className="text-muted-foreground">Today (M3에서 제공)</span>
    </nav>
  )
}
