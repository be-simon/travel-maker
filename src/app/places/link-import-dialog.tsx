'use client'

import { useEffect, useRef, useState } from 'react'
import { useMapsLibrary } from '@vis.gl/react-google-maps'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { createBookmark } from '@/lib/bookmarks/actions'
import { parseGmapUrl, type ParsedGmapPlace } from '@/lib/places/gmap-url'
import { extractCountryCity } from '@/lib/places/address'
import { CATEGORY_OPTIONS } from '@/lib/spot-categories'
import type { Bookmark, SpotCategory } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface PlacePreview {
  placeId: string | null
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  country: string | null
  city: string | null
  openingHours: string[]
}

type Step = { kind: 'input' } | { kind: 'loading' } | { kind: 'preview'; preview: PlacePreview }

const PLACE_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'addressComponents',
  'regularOpeningHours',
]

// 구글맵 공유 링크 → Edge Function으로 리다이렉트 해석 → 순수 파서로 후보 추출 →
// Places API로 확정해 미리보기 → 사용자가 확인 후 저장 (PRD F3: 자동 신뢰하지 않음).
export function LinkImportDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing: Bookmark[]
}) {
  const placesLib = useMapsLibrary('places')
  const [url, setUrl] = useState('')
  const [step, setStep] = useState<Step>({ kind: 'input' })
  const [category, setCategory] = useState<SpotCategory>('sight')
  const [country, setCountry] = useState('')
  const [city, setCity] = useState('')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // 다이얼로그가 닫혔다 다시 열리면 진행 중이던 응답은 무시한다 — 이전 링크의
  // 미리보기/저장이 새 세션을 덮어쓰지 않게 open/close 전환마다 세션을 증가시킨다.
  const sessionRef = useRef(0)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    sessionRef.current += 1
    if (open) {
      setUrl('')
      setStep({ kind: 'input' })
      setCategory('sight')
      setCountry('')
      setCity('')
      setMemo('')
      setError(null)
      setSaving(false)
    }
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  const preview = step.kind === 'preview' ? step.preview : null
  const duplicate =
    preview?.placeId != null
      ? existing.find((bookmark) => bookmark.place_id === preview.placeId)
      : undefined

  const lookupPlace = async (parsed: ParsedGmapPlace): Promise<PlacePreview | null> => {
    if (!placesLib) {
      throw new Error('지도 API 키가 설정되지 않아 장소를 확인할 수 없습니다.')
    }

    let place: google.maps.places.Place | null = null
    if (parsed.placeId) {
      const candidate = new placesLib.Place({ id: parsed.placeId })
      try {
        await candidate.fetchFields({ fields: PLACE_FIELDS })
        place = candidate
      } catch {
        // ChIJ 토큰이 항상 유효한 place_id는 아니다 — 이름 검색으로 폴백.
        place = null
      }
    }
    if (!place && parsed.name) {
      const { places } = await placesLib.Place.searchByText({
        textQuery: parsed.name,
        fields: PLACE_FIELDS,
        maxResultCount: 1,
        ...(parsed.lat != null && parsed.lng != null
          ? { locationBias: { lat: parsed.lat, lng: parsed.lng } }
          : {}),
      })
      place = places[0] ?? null
    }
    if (!place) return null

    const { country: parsedCountry, city: parsedCity } = extractCountryCity(place.addressComponents)
    return {
      placeId: place.id ?? parsed.placeId,
      name: place.displayName ?? parsed.name ?? '',
      address: place.formattedAddress ?? null,
      lat: place.location ? place.location.lat() : parsed.lat,
      lng: place.location ? place.location.lng() : parsed.lng,
      country: parsedCountry,
      city: parsedCity,
      openingHours: place.regularOpeningHours?.weekdayDescriptions ?? [],
    }
  }

  const resolve = async () => {
    const session = sessionRef.current
    setError(null)
    setStep({ kind: 'loading' })
    try {
      const supabase = createClient()
      const { data, error: fnError } = await supabase.functions.invoke('resolve-gmap-link', {
        body: { url },
      })
      if (sessionRef.current !== session) return
      if (fnError) {
        throw new Error('링크를 해석하지 못했습니다. Google 지도 공유 링크인지 확인해 주세요.')
      }
      const parsed = parseGmapUrl((data as { finalUrl: string }).finalUrl)
      if (!parsed) {
        throw new Error('링크에서 장소 정보를 찾지 못했습니다. 직접 입력으로 저장해 주세요.')
      }
      const found = await lookupPlace(parsed)
      if (sessionRef.current !== session) return
      if (!found) {
        throw new Error('장소를 특정하지 못했습니다. 직접 입력으로 저장해 주세요.')
      }
      setCountry(found.country ?? '')
      setCity(found.city ?? '')
      setStep({ kind: 'preview', preview: found })
    } catch (caught) {
      if (sessionRef.current !== session) return
      setError(caught instanceof Error ? caught.message : '링크를 해석하지 못했습니다.')
      setStep({ kind: 'input' })
    }
  }

  const save = () => {
    if (!preview) return
    const session = sessionRef.current
    setSaving(true)
    setError(null)
    void (async () => {
      const result = await createBookmark({
        name: preview.name,
        category,
        country: country || null,
        city: city || null,
        placeId: preview.placeId,
        lat: preview.lat,
        lng: preview.lng,
        address: preview.address,
        memo,
        source: 'gmap_link',
      })
      if (sessionRef.current !== session) return
      setSaving(false)
      if (result.error) {
        setError(result.error)
      } else {
        toast('장소를 저장했어요')
        onOpenChange(false)
      }
    })()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>링크로 장소 저장</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {step.kind !== 'preview' && (
            <div>
              <label className="mb-1 block text-sm font-medium">Google 지도 공유 링크</label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://maps.app.goo.gl/…"
                disabled={step.kind === 'loading'}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                구글맵 앱·웹의 공유 버튼으로 복사한 링크를 붙여넣으세요. 단축링크도 됩니다.
              </p>
            </div>
          )}

          {step.kind === 'loading' && (
            <p className="text-sm text-muted-foreground">링크를 확인하는 중…</p>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="rounded-lg border p-3">
                <div className="font-medium">{preview.name}</div>
                {preview.address && (
                  <div className="mt-0.5 text-xs text-muted-foreground">{preview.address}</div>
                )}
                {preview.lat != null && preview.lng != null && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    좌표 {preview.lat.toFixed(5)}, {preview.lng.toFixed(5)}
                  </div>
                )}
                {preview.openingHours.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      영업시간
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {preview.openingHours.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              {duplicate && (
                <p className="text-sm text-amber-700">이미 저장된 장소예요: {duplicate.name}</p>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium">카테고리</label>
                <Select
                  items={CATEGORY_OPTIONS}
                  value={category}
                  onValueChange={(value) => setCategory(value as SpotCategory)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">국가</label>
                  <Input value={country} onChange={(e) => setCountry(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">도시</label>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">메모</label>
                <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          {step.kind === 'preview' && (
            <Button variant="outline" onClick={() => setStep({ kind: 'input' })} disabled={saving}>
              다른 링크
            </Button>
          )}
          {step.kind === 'preview' ? (
            <Button onClick={save} disabled={saving || duplicate !== undefined}>
              {saving ? '저장하는 중…' : '저장'}
            </Button>
          ) : (
            <Button onClick={resolve} disabled={step.kind === 'loading' || url.trim() === ''}>
              {step.kind === 'loading' ? '확인하는 중…' : '링크 확인'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
