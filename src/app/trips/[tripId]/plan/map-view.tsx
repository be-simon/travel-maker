'use client'

import { Map, Marker, useMap } from '@vis.gl/react-google-maps'
import type { PlanBlock, Spot } from '@/types/database'
import { MapProvider } from '@/components/map/map-provider'

// 좌표가 있는 스팟이 하나도 없을 때(빈 트립)의 기본 중심점 — 서울시청.
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }

interface LocatedSpot extends Spot {
  lat: number
  lng: number
}

function isLocated(spot: Spot): spot is LocatedSpot {
  return spot.lat !== null && spot.lng !== null
}

// google.maps.* 상수(SymbolPath 등)는 지도 SDK 로드가 끝나기 전까지 존재하지
// 않는다. useMap()이 null을 반환하는 동안(로드 전)에는 아무것도 렌더링하지
// 않고, 실제 지도 인스턴스가 생긴 뒤에만(=SDK가 로드된 뒤에만) 마커를 그려서
// "google is not defined" 런타임 에러를 피한다.
function SpotMarkers({ spots }: { spots: LocatedSpot[] }) {
  const map = useMap()
  if (!map) return null

  return (
    <>
      {spots.map((spot) => {
        const isConfirmed = spot.status !== 'candidate'
        return (
          <Marker
            key={spot.id}
            position={{ lat: spot.lat, lng: spot.lng }}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: spot.priority ? 11 : 8,
              fillColor: isConfirmed ? '#2563eb' : '#9ca3af',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: spot.priority ? 3 : 2,
            }}
          />
        )
      })}
    </>
  )
}

export function MapView({
  spots,
}: {
  tripId: number
  startDate: string
  endDate: string
  blocks: PlanBlock[]
  spots: Spot[]
}) {
  const located = spots.filter(isLocated)
  const center = located.length > 0 ? { lat: located[0].lat, lng: located[0].lng } : DEFAULT_CENTER

  return (
    <MapProvider>
      <div className="h-[600px] w-full overflow-hidden rounded-lg border">
        <Map
          defaultCenter={center}
          defaultZoom={located.length > 0 ? 12 : 10}
          gestureHandling="greedy"
          mapId={undefined}
        >
          <SpotMarkers spots={located} />
        </Map>
      </div>
      {spots.length > 0 && located.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          좌표가 있는 장소가 없습니다. 장소를 추가할 때 검색 결과에서 선택하면 지도에 표시됩니다.
        </p>
      )}
    </MapProvider>
  )
}
