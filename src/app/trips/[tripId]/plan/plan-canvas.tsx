'use client'

import { useState } from 'react'
import type { PlanBlock, Spot, SpotGroup } from '@/types/database'
import { Button } from '@/components/ui/button'
import { TimelineView } from './timeline-view'
import { MapView } from './map-view'

type CanvasMode = 'timeline' | 'map'

export function PlanCanvas({
  tripId,
  startDate,
  endDate,
  blocks,
  spots,
  groups,
}: {
  tripId: number
  startDate: string
  endDate: string
  blocks: PlanBlock[]
  spots: Spot[]
  groups: SpotGroup[]
}) {
  const [mode, setMode] = useState<CanvasMode>('timeline')

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <Button
          variant={mode === 'timeline' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('timeline')}
        >
          타임라인
        </Button>
        <Button variant={mode === 'map' ? 'default' : 'outline'} size="sm" onClick={() => setMode('map')}>
          지도
        </Button>
      </div>
      {mode === 'timeline' ? (
        <TimelineView
          tripId={tripId}
          startDate={startDate}
          endDate={endDate}
          blocks={blocks}
          spots={spots}
          groups={groups}
        />
      ) : (
        <MapView
          tripId={tripId}
          startDate={startDate}
          endDate={endDate}
          blocks={blocks}
          spots={spots}
          groups={groups}
        />
      )}
    </div>
  )
}
