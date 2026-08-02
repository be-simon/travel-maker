'use client'

import { useState } from 'react'
import { Map, Marker, useMap, InfoWindow, Polyline } from '@vis.gl/react-google-maps'
import type { PlanBlock, Spot, SpotCategory, SpotGroup } from '@/types/database'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { enumerateDates } from './timeline-view'
import { BlockDialog, type BlockDraft } from './block-dialog'

// 좌표가 있는 스팟이 하나도 없을 때(빈 트립)의 기본 중심점 — 서울시청.
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }

// MapProvider는 이제 page.tsx에서 한 번만 감싸며(AddSpotDialog도 API 키 유무와
// 무관하게 항상 렌더링돼야 하므로), 키가 없을 때 fallback을 보여주지 않는다.
// 실제로 지도를 그려야 하는 이 컴포넌트가 키 유무를 직접 확인해서 fallback을
// 책임진다.
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

const CATEGORY_LABELS: Record<SpotCategory, string> = {
  sight: '관광',
  restaurant: '식당',
  cafe: '카페',
  shopping: '쇼핑',
  lodging: '숙소',
  etc: '기타',
}

interface LocatedSpot extends Spot {
  lat: number
  lng: number
}

function isLocated(spot: Spot): spot is LocatedSpot {
  return spot.lat !== null && spot.lng !== null
}

function spotIdsScheduledOnDate(blocks: PlanBlock[], date: string): Set<number> {
  const ids = new Set<number>()
  for (const block of blocks) {
    if (block.date === date && block.type === 'spot' && block.spot_id !== null) {
      ids.add(block.spot_id)
    }
  }
  return ids
}

interface RouteStop {
  spot: LocatedSpot
  sequence: number
}

function buildRouteForDate(blocks: PlanBlock[], spots: LocatedSpot[], date: string): RouteStop[] {
  // 이 파일은 '@vis.gl/react-google-maps'의 `Map` 컴포넌트를 값으로 import해서
  // 지역 스코프의 `Map` 식별자를 가린다 — 전역 Map 생성자를 쓰려면
  // globalThis.Map으로 명시해야 한다(그냥 `new Map(...)`은 컴포넌트를
  // 생성자로 오인해 타입 에러가 난다).
  const spotById = new globalThis.Map(spots.map((spot) => [spot.id, spot]))
  return blocks
    .filter((block) => block.date === date && block.type === 'spot' && block.spot_id !== null)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .map((block) => spotById.get(block.spot_id!))
    .filter((spot): spot is LocatedSpot => spot !== undefined)
    .map((spot, index) => ({ spot, sequence: index + 1 }))
}

// google.maps.* 상수(SymbolPath 등)는 지도 SDK 로드가 끝나기 전까지 존재하지
// 않는다. useMap()이 null을 반환하는 동안(로드 전)에는 아무것도 렌더링하지
// 않고, 실제 지도 인스턴스가 생긴 뒤에만(=SDK가 로드된 뒤에만) 마커를 그려서
// "google is not defined" 런타임 에러를 피한다.
function SpotMarkers({
  spots,
  onMarkerClick,
}: {
  spots: LocatedSpot[]
  onMarkerClick: (spot: LocatedSpot) => void
}) {
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
            onClick={() => onMarkerClick(spot)}
          />
        )
      })}
    </>
  )
}

// SpotMarkers와 동일한 이유(useMap()이 null인 동안엔 google.maps.* SDK가 아직
// 로드되지 않았을 수 있다)로 같은 게이팅 패턴을 적용한다. Polyline의 path는
// 순수 {lat, lng} 리터럴이라 이 컴포넌트 자체는 게이트가 엄밀히 필요하진
// 않지만, "Maps SDK 백엔드 컴포넌트를 그려도 안전한가"의 일관된 가드로
// SpotMarkers와 동일하게 적용한다.
function RouteOverlay({ route }: { route: RouteStop[] }) {
  const map = useMap()
  if (!map || route.length === 0) return null

  return (
    <>
      <Polyline
        path={route.map(({ spot }) => ({ lat: spot.lat, lng: spot.lng }))}
        strokeColor="#2563eb"
        strokeOpacity={0.8}
        strokeWeight={3}
      />
      {route.map(({ spot, sequence }) => (
        <Marker
          key={`route-${spot.id}`}
          position={{ lat: spot.lat, lng: spot.lng }}
          label={{ text: String(sequence), color: '#ffffff', fontWeight: 'bold' }}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: '#2563eb',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          }}
        />
      ))}
    </>
  )
}

export function MapView({
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
  const [dateFilter, setDateFilter] = useState<string>('all')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const [selectedSpot, setSelectedSpot] = useState<LocatedSpot | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<BlockDraft | null>(null)

  // 모든 훅 호출(useState) 다음에 체크한다 — Rules of Hooks는 훅 호출 뒤에
  // 오는 조건부 early return은 허용한다(이후에 더 이상 훅을 호출하지 않는
  // 한). API_KEY는 모듈 로드 시 한 번 고정되는 상수라 이 컴포넌트 인스턴스는
  // 리렌더마다 항상 같은 분기만 타므로 훅 호출 수도 안정적이다.
  if (!API_KEY) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        지도를 표시하려면 Google Maps API 키가 필요합니다.
        <br />
        관리자가 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 환경 변수를 설정해야 합니다.
      </div>
    )
  }

  const openAddToScheduleDialog = () => {
    if (!selectedSpot) return
    setDraft({
      tripId: selectedSpot.trip_id,
      date: startDate,
      startTime: '09:00',
      endTime: '10:00',
      spotId: selectedSpot.id,
    })
    setDialogOpen(true)
    setSelectedSpot(null)
  }

  const scheduledOnDate = dateFilter === 'all' ? null : spotIdsScheduledOnDate(blocks, dateFilter)

  const filtered = spots.filter((spot) => {
    if (groupFilter !== 'all' && String(spot.group_id) !== groupFilter) return false
    if (categoryFilter !== 'all' && spot.category !== categoryFilter) return false
    // 날짜 필터는 확정된(候補가 아닌) 스팟에만 적용한다 — 후보는 아직 날짜에
    // 묶이지 않았으므로, 특정 날짜를 골라도 "이 날 근처에 가볼 만한 후보가
    // 있는지"는 계속 보여줘야 한다.
    if (scheduledOnDate && spot.status !== 'candidate' && !scheduledOnDate.has(spot.id)) return false
    return true
  })

  const located = filtered.filter(isLocated)
  const center = located.length > 0 ? { lat: located[0].lat, lng: located[0].lng } : DEFAULT_CENTER
  const route = dateFilter === 'all' ? [] : buildRouteForDate(blocks, located, dateFilter)

  // Select(Base UI)는 닫힌 트리거에 선택된 라벨을 보여주려면 items 배열이
  // 필요하다 — 없으면 SelectItem의 children이 아니라 원시 value 문자열을
  // 그대로 보여준다(M2 플랜에서 add-spot-dialog.tsx/block-dialog.tsx에 적용한
  // 것과 동일한 이유). 아래 세 필터 모두 "전체 ..." 옵션의 value가 'all'이라
  // 그 자체로는 라벨과 다르고, 도시/카테고리 필터는 선택된 실제 항목의
  // value(그룹 id/카테고리 코드)도 라벨(그룹 이름/한글 카테고리명)과 다르므로
  // items 없이는 트리거가 'all'이나 원시 id/코드를 그대로 보여주는 버그가 난다.
  const dateItems = [
    { value: 'all', label: '전체 날짜' },
    ...enumerateDates(startDate, endDate).map((date) => ({ value: date, label: date })),
  ]
  const groupItems = [
    { value: 'all', label: '전체 도시' },
    ...groups.map((group) => ({ value: String(group.id), label: group.name })),
  ]
  const categoryItems = [
    { value: 'all', label: '전체 카테고리' },
    ...(Object.entries(CATEGORY_LABELS) as [SpotCategory, string][]).map(([value, label]) => ({ value, label })),
  ]

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select items={dateItems} value={dateFilter} onValueChange={(value) => setDateFilter(value ?? 'all')}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 날짜</SelectItem>
            {enumerateDates(startDate, endDate).map((date) => (
              <SelectItem key={date} value={date}>
                {date}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select items={groupItems} value={groupFilter} onValueChange={(value) => setGroupFilter(value ?? 'all')}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 도시</SelectItem>
            {groups.map((group) => (
              <SelectItem key={group.id} value={String(group.id)}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={categoryItems}
          value={categoryFilter}
          onValueChange={(value) => setCategoryFilter(value ?? 'all')}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 카테고리</SelectItem>
            {(Object.entries(CATEGORY_LABELS) as [SpotCategory, string][]).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="h-[600px] w-full overflow-hidden rounded-lg border">
        <Map
          defaultCenter={center}
          defaultZoom={located.length > 0 ? 12 : 10}
          gestureHandling="greedy"
          mapId={undefined}
        >
          <SpotMarkers spots={located} onMarkerClick={setSelectedSpot} />
          <RouteOverlay route={route} />
          {selectedSpot && (
            <InfoWindow
              position={{ lat: selectedSpot.lat, lng: selectedSpot.lng }}
              onCloseClick={() => setSelectedSpot(null)}
            >
              <div className="space-y-1 p-1 text-sm">
                <p className="font-medium">{selectedSpot.name}</p>
                <p className="text-xs text-muted-foreground">{CATEGORY_LABELS[selectedSpot.category]}</p>
                {selectedSpot.address && <p className="text-xs text-muted-foreground">{selectedSpot.address}</p>}
                {selectedSpot.memo && <p className="text-xs">{selectedSpot.memo}</p>}
                <Button size="sm" onClick={openAddToScheduleDialog}>
                  일정에 추가
                </Button>
              </div>
            </InfoWindow>
          )}
        </Map>
      </div>
      {filtered.length > 0 && located.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          좌표가 있는 장소가 없습니다. 장소를 추가할 때 검색 결과에서 선택하면 지도에 표시됩니다.
        </p>
      )}
      <BlockDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        draft={draft}
        editingBlock={null}
        spots={spots}
        tripStartDate={startDate}
        tripEndDate={endDate}
      />
    </>
  )
}
