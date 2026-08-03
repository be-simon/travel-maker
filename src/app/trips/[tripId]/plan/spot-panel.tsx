'use client'

import { useState } from 'react'
import type { Bookmark, Spot, SpotGroup } from '@/types/database'
import { Button } from '@/components/ui/button'
import { AddSpotDialog } from './add-spot-dialog'
import { ImportBookmarksDialog } from './import-bookmarks-dialog'
import { CATEGORY_LABELS } from '@/lib/spot-categories'

const STATUS_LABELS: Record<string, string> = {
  candidate: '후보',
  planned: '배치됨',
  visited: '방문완료',
}

function SpotRow({ spot }: { spot: Spot }) {
  return (
    <li className="flex items-center justify-between rounded border p-2 text-sm">
      <span>{spot.name}</span>
      <span className="text-xs text-muted-foreground">
        {CATEGORY_LABELS[spot.category]} · {STATUS_LABELS[spot.status]}
      </span>
    </li>
  )
}

export function SpotPanel({
  tripId,
  spots,
  groups,
  bookmarks,
}: {
  tripId: number
  spots: Spot[]
  groups: SpotGroup[]
  bookmarks: Bookmark[]
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const grouped = groups
    .map((group) => ({ group, spots: spots.filter((spot) => spot.group_id === group.id) }))
    .filter(({ spots: groupSpots }) => groupSpots.length > 0)
  const ungrouped = spots.filter((spot) => spot.group_id === null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">장소</h2>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            저장한 장소에서
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            + 장소 추가
          </Button>
        </div>
      </div>

      {spots.length === 0 && <p className="text-sm text-muted-foreground">아직 담긴 장소가 없습니다.</p>}

      {grouped.map(({ group, spots: groupSpots }) => (
        <div key={group.id}>
          <h3 className="mb-1 text-sm font-medium text-muted-foreground">{group.name}</h3>
          <ul className="space-y-1">
            {groupSpots.map((spot) => (
              <SpotRow key={spot.id} spot={spot} />
            ))}
          </ul>
        </div>
      ))}

      {ungrouped.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-medium text-muted-foreground">그룹 없음</h3>
          <ul className="space-y-1">
            {ungrouped.map((spot) => (
              <SpotRow key={spot.id} spot={spot} />
            ))}
          </ul>
        </div>
      )}

      <AddSpotDialog tripId={tripId} groups={groups} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ImportBookmarksDialog
        tripId={tripId}
        bookmarks={bookmarks}
        spots={spots}
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </div>
  )
}
