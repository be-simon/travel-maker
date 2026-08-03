'use client'

import { useAutocompleteSuggestions } from '@/lib/places/use-autocomplete-suggestions'
import { extractCountryCity } from '@/lib/places/address'
import { Input } from '@/components/ui/input'

export interface PlaceSelection {
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  placeId: string
  country: string | null
  city: string | null
}

// AddSpotDialog에서 추출한 Places 검색 입력. 타이핑하면 onValueChange로 부모가
// 이전 선택을 무효화하고, 제안을 선택하면 상세를 조회해 onSelect로 전달한다.
// fetchFields 실패 시 폼 상태를 건드리지 않고 onError만 호출한다(기존 방어 패턴).
export function PlaceSearchInput({
  value,
  onValueChange,
  onSelect,
  onError,
  placeholder,
}: {
  value: string
  onValueChange: (value: string) => void
  onSelect: (selection: PlaceSelection) => void
  onError: (message: string) => void
  placeholder?: string
}) {
  const { suggestions, resetSession } = useAutocompleteSuggestions(value)

  const selectSuggestion = async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    if (!suggestion.placePrediction) return
    const place = suggestion.placePrediction.toPlace()
    try {
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location', 'addressComponents'],
      })
    } catch (error) {
      console.error('selectSuggestion failed:', error)
      onError('장소 정보를 불러오지 못했습니다. 다시 시도해 주세요.')
      return
    }

    const { country, city } = extractCountryCity(place.addressComponents)
    onSelect({
      name: place.displayName ?? '',
      address: place.formattedAddress ?? null,
      // place.location은 google.maps.LatLng 객체 — .lat()/.lng() 호출 필요.
      lat: place.location ? place.location.lat() : null,
      lng: place.location ? place.location.lng() : null,
      placeId: suggestion.placePrediction.placeId,
      country,
      city,
    })
    resetSession()
  }

  return (
    <div>
      <Input value={value} onChange={(e) => onValueChange(e.target.value)} placeholder={placeholder} />
      {suggestions.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border text-sm">
          {suggestions.map((suggestion, index) => (
            <li
              key={index}
              className="cursor-pointer px-2 py-1.5 hover:bg-accent"
              onClick={() => selectSuggestion(suggestion)}
            >
              {suggestion.placePrediction?.text.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
