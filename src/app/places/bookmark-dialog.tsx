'use client'

import { useEffect, useState, useTransition } from 'react'
import { createBookmark, updateBookmark } from '@/lib/bookmarks/actions'
import { PlaceSearchInput } from '@/components/places/place-search-input'
import { CATEGORY_OPTIONS } from '@/lib/spot-categories'
import type { Bookmark, SpotCategory } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// 추가·수정 겸용. 추가 모드는 Places 검색으로 국가/도시를 자동 태깅하고, 선택
// 즉시 place_id 중복을 확인해 저장 대신 기존 항목으로 안내한다 (PRD §4 F3).
// 수정 모드는 place_id·좌표를 유지한 채 텍스트 필드만 편집한다.
export function BookmarkDialog({
  open,
  onOpenChange,
  editing,
  existing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: Bookmark | null
  existing: Bookmark[]
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<SpotCategory>('sight')
  const [country, setCountry] = useState('')
  const [city, setCity] = useState('')
  const [memo, setMemo] = useState('')
  const [placeId, setPlaceId] = useState<string | null>(null)
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // AddSpotDialog와 같은 [open] 초기화 패턴 — 수정 모드는 editing 값으로 채운다.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '')
      setCategory(editing?.category ?? 'sight')
      setCountry(editing?.country ?? '')
      setCity(editing?.city ?? '')
      setMemo(editing?.memo ?? '')
      setPlaceId(editing?.place_id ?? null)
      setLat(editing?.lat ?? null)
      setLng(editing?.lng ?? null)
      setAddress(editing?.address ?? null)
      setError(null)
    }
  }, [open, editing])
  /* eslint-enable react-hooks/set-state-in-effect */

  const duplicate =
    placeId !== null
      ? existing.find((bookmark) => bookmark.place_id === placeId && bookmark.id !== editing?.id)
      : undefined

  const submit = () => {
    startTransition(async () => {
      const result = editing
        ? await updateBookmark(editing.id, {
            name,
            category,
            country: country || null,
            city: city || null,
            memo,
          })
        : await createBookmark({
            name,
            category,
            country: country || null,
            city: city || null,
            placeId,
            lat,
            lng,
            address,
            memo,
          })
      if (result.error) {
        setError(result.error)
      } else {
        onOpenChange(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? '장소 수정' : '장소 저장'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">이름</label>
            {editing ? (
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            ) : (
              <PlaceSearchInput
                value={name}
                onValueChange={(value) => {
                  setName(value)
                  setPlaceId(null)
                  setLat(null)
                  setLng(null)
                  setAddress(null)
                }}
                onSelect={(selection) => {
                  setName(selection.name)
                  setAddress(selection.address)
                  setLat(selection.lat)
                  setLng(selection.lng)
                  setPlaceId(selection.placeId)
                  setCountry(selection.country ?? '')
                  setCity(selection.city ?? '')
                }}
                onError={setError}
                placeholder="예: 두오모 (검색해서 선택하면 정보가 채워집니다)"
              />
            )}
            {address && <p className="mt-1 text-xs text-muted-foreground">{address}</p>}
            {duplicate && (
              <p className="mt-1 text-sm text-amber-700">
                이미 저장된 장소예요: {duplicate.name}
              </p>
            )}
          </div>
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
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="자동 태깅" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">도시</label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="자동 태깅" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">메모</label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={isPending || duplicate !== undefined}>
            {isPending ? '저장하는 중…' : editing ? '수정' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
