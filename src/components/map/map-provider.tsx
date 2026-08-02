'use client'

import type { ReactNode } from 'react'
import { APIProvider } from '@vis.gl/react-google-maps'

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

// 이 컴포넌트는 지도(MapView)뿐 아니라 장소 추가 다이얼로그(AddSpotDialog, 지도
// 탭 밖의 SpotPanel 쪽)도 감싼다 — 후자는 API 키가 없어도 항상 정상 렌더링되어야
// 하므로, 키가 없을 때 children을 감춰버리는 fallback을 이 레벨에서 보여주면 안
// 된다. "API 키가 필요합니다" 메시지는 지도를 실제로 그려야 하는 MapView가 직접
// 책임진다.
export function MapProvider({ children }: { children: ReactNode }) {
  if (!API_KEY) {
    return <>{children}</>
  }

  return (
    <APIProvider apiKey={API_KEY} libraries={['places']}>
      {children}
    </APIProvider>
  )
}
