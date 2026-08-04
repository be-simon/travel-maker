'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMapsLibrary } from '@vis.gl/react-google-maps'

// PRD §5: Places 상세(영업시간)는 영속 저장하지 않고 조회 시점에 place_id로
// 재조회한다. 캐시는 세션(모듈 스코프) 한정.
const sessionCache = new Map<string, boolean | null>()

export function useOpenNow(placeIds: string[]): Record<string, boolean | null> {
  const placesLib = useMapsLibrary('places')
  const [statuses, setStatuses] = useState<Record<string, boolean | null>>({})
  const cacheKey = useMemo(() => placeIds.join(','), [placeIds])

  useEffect(() => {
    if (!placesLib || placeIds.length === 0) return
    let cancelled = false

    ;(async () => {
      const next: Record<string, boolean | null> = {}
      for (const id of placeIds) {
        const cached = sessionCache.get(id)
        if (cached !== undefined) {
          next[id] = cached
          continue
        }
        try {
          const place = new placesLib.Place({ id })
          await place.fetchFields({ fields: ['regularOpeningHours', 'utcOffsetMinutes'] })
          const open = await place.isOpen()
          const value = open === undefined ? null : open
          sessionCache.set(id, value)
          next[id] = value
        } catch {
          sessionCache.set(id, null)
          next[id] = null
        }
      }
      if (!cancelled) setStatuses(next)
    })()

    return () => {
      cancelled = true
    }
    // placeIds 배열은 렌더마다 새 참조라 join한 cacheKey로 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesLib, cacheKey])

  return statuses
}
