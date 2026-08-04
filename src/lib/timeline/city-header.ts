import type { PlanBlock, Spot } from '@/types/database'

// PRD F4: 도시 단위 상단 그룹핑(예: 밀라노 2박). 날짜→도시 매핑이 별도 데이터로
// 존재하지 않으므로, 그 날짜에 배치된 스팟 블록들의 spot_group 최빈값을 그날의
// 도시로 삼는다(동률은 먼저 등장한 그룹, 없으면 null).

export interface CitySpan {
  label: string | null
  startIndex: number
  length: number
}

export function dominantGroupName(
  dateBlocks: PlanBlock[],
  spotById: Map<number, Spot>,
  groupNameById: Map<number, string>
): string | null {
  const counts = new Map<string, number>()
  const firstSeen = new Map<string, number>()
  let order = 0

  for (const block of dateBlocks) {
    if (block.spot_id == null) continue
    const spot = spotById.get(block.spot_id)
    if (!spot || spot.group_id == null) continue
    const name = groupNameById.get(spot.group_id)
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
    if (!firstSeen.has(name)) firstSeen.set(name, order++)
  }

  let best: string | null = null
  for (const [name, count] of counts) {
    if (
      best === null ||
      count > counts.get(best)! ||
      (count === counts.get(best)! && firstSeen.get(name)! < firstSeen.get(best)!)
    ) {
      best = name
    }
  }
  return best
}

export function cityHeaderSpans(
  dates: string[],
  blocks: PlanBlock[],
  spotById: Map<number, Spot>,
  groupNameById: Map<number, string>
): CitySpan[] {
  const labels = dates.map((date) =>
    dominantGroupName(
      blocks.filter((block) => block.date === date),
      spotById,
      groupNameById
    )
  )

  const spans: CitySpan[] = []
  labels.forEach((label, index) => {
    const last = spans[spans.length - 1]
    if (last && last.label === label) last.length++
    else spans.push({ label, startIndex: index, length: 1 })
  })
  return spans
}
