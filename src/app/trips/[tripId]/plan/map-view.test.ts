import { describe, it, expect } from 'vitest'

// Mirrors map-view.tsx's spotIdsScheduledOnDate — kept in sync manually since
// it's not exported (small, private helper). If this drifts from the real
// implementation, that's a signal to export it properly; for now this proves
// the *intended* semantics independent of the Google Maps-dependent component.
function spotIdsScheduledOnDate(
  blocks: { date: string; type: string; spot_id: number | null }[],
  date: string
): Set<number> {
  const ids = new Set<number>()
  for (const block of blocks) {
    if (block.date === date && block.type === 'spot' && block.spot_id !== null) {
      ids.add(block.spot_id)
    }
  }
  return ids
}

describe('spotIdsScheduledOnDate', () => {
  it('only includes spot-type blocks on the exact date with a linked spot', () => {
    const blocks = [
      { date: '2026-06-01', type: 'spot', spot_id: 1 },
      { date: '2026-06-01', type: 'transport', spot_id: null },
      { date: '2026-06-02', type: 'spot', spot_id: 2 },
      { date: '2026-06-01', type: 'spot', spot_id: null },
    ]
    expect(spotIdsScheduledOnDate(blocks, '2026-06-01')).toEqual(new Set([1]))
  })

  it('returns an empty set for a date with no matching blocks', () => {
    expect(spotIdsScheduledOnDate([], '2026-06-01')).toEqual(new Set())
  })
})
