import type { PlanBlock, Spot } from '@/types/database'
import { haversineKm, timeToMinutes, walkMinutes } from '@/lib/today/engine'

// PRD F4: 연속된 두 블록 사이의 이동 시간을 좌표 기반 직선거리로 추정해 참고
// 힌트로 보여준다(실제 도보 경로와 다를 수 있음은 UI가 명시).

export interface TravelHint {
  fromBlockId: number
  toBlockId: number
  boundaryMin: number
  walkMin: number
}

export function travelHints(
  dayBlocks: PlanBlock[],
  spotById: Map<number, Spot>
): TravelHint[] {
  const located = dayBlocks
    .map((block) => {
      if (block.spot_id == null) return null
      const spot = spotById.get(block.spot_id)
      if (!spot || spot.lat == null || spot.lng == null) return null
      return { block, spot }
    })
    .filter((x): x is { block: PlanBlock; spot: Spot } => x !== null)
    .sort((a, b) => a.block.start_time.localeCompare(b.block.start_time))

  const hints: TravelHint[] = []
  for (let i = 0; i + 1 < located.length; i++) {
    const from = located[i]
    const to = located[i + 1]
    if (from.spot.id === to.spot.id) continue
    const km = haversineKm(
      { lat: from.spot.lat!, lng: from.spot.lng! },
      { lat: to.spot.lat!, lng: to.spot.lng! }
    )
    hints.push({
      fromBlockId: from.block.id,
      toBlockId: to.block.id,
      boundaryMin: timeToMinutes(to.block.start_time),
      walkMin: walkMinutes(km),
    })
  }
  return hints
}
