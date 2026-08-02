'use client'

import type { ReactNode } from 'react'
import { APIProvider } from '@vis.gl/react-google-maps'

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

export function MapProvider({ children }: { children: ReactNode }) {
  if (!API_KEY) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        지도를 표시하려면 Google Maps API 키가 필요합니다.
        <br />
        관리자가 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 환경 변수를 설정해야 합니다.
      </div>
    )
  }

  return (
    <APIProvider apiKey={API_KEY} libraries={['places']}>
      {children}
    </APIProvider>
  )
}
