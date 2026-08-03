'use client'

import { useEffect, useState, useTransition } from 'react'
import { createSpot } from '@/lib/spots/actions'
import { useAutocompleteSuggestions } from '@/lib/places/use-autocomplete-suggestions'
import type { SpotCategory, SpotGroup } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CATEGORY_OPTIONS } from '@/lib/spot-categories'

export function AddSpotDialog({
  tripId,
  groups,
  open,
  onOpenChange,
}: {
  tripId: number
  groups: SpotGroup[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<SpotCategory>('sight')
  const [groupId, setGroupId] = useState<string>('new')
  const [newGroupName, setNewGroupName] = useState('')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [placeId, setPlaceId] = useState<string | null>(null)
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const { suggestions, resetSession } = useAutocompleteSuggestions(name)

  const groupItems = [
    { value: 'new', label: '+ 새 그룹' },
    ...groups.map((group) => ({ value: String(group.id), label: group.name })),
  ]

  const reset = () => {
    setName('')
    setCategory('sight')
    setGroupId('new')
    setNewGroupName('')
    setMemo('')
    setError(null)
    setPlaceId(null)
    setLat(null)
    setLng(null)
    setAddress(null)
    resetSession()
  }

  // 다이얼로그를 제출 없이 닫았다가(X 버튼/Escape/배경 클릭) 다시 열면 이전
  // 입력이 그대로 남아있던 문제 — BlockDialog와 동일하게 open을 의존성으로 하는
  // effect에서 매번 초기화한다. 이 다이얼로그는 생성 전용이라 동기화할 기존
  // 데이터가 없으므로 [open]만으로 충분하다.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setName('')
      setCategory('sight')
      setGroupId('new')
      setNewGroupName('')
      setMemo('')
      setError(null)
      setPlaceId(null)
      setLat(null)
      setLng(null)
      setAddress(null)
      resetSession()
    }
    // resetSession is intentionally omitted: it's a new function identity on
    // every render (not memoized), so including it would re-run this effect
    // every render instead of only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectSuggestion = async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    if (!suggestion.placePrediction) return
    const place = suggestion.placePrediction.toPlace()
    try {
      await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] })
    } catch (error) {
      // 리퍼러 제한된(또는 아직 설정 중인) API 키, 쿼터 초과, 네트워크 장애
      // 등으로 실패할 수 있다 — 여기서 실패하면 폼 필드는 절대 건드리지 않고
      // (이전 입력이 그대로 유지됨) 사용자가 직접 입력하거나 다시 시도할 수
      // 있게 한다.
      console.error('selectSuggestion failed:', error)
      setError('장소 정보를 불러오지 못했습니다. 다시 시도해 주세요.')
      return
    }

    setName(place.displayName ?? '')
    setAddress(place.formattedAddress ?? null)
    // place.location is a google.maps.LatLng object (methods, not plain
    // {lat, lng} properties) — calling .lat()/.lng() is required here.
    setLat(place.location ? place.location.lat() : null)
    setLng(place.location ? place.location.lng() : null)
    setPlaceId(suggestion.placePrediction.placeId)
    resetSession()
  }

  const submit = () => {
    startTransition(async () => {
      const result = await createSpot({
        tripId,
        name,
        category,
        memo,
        groupId: groupId === 'new' ? null : Number(groupId),
        newGroupName: groupId === 'new' ? newGroupName : '',
        placeId,
        lat,
        lng,
        address,
      })
      if (result.error) {
        setError(result.error)
      } else {
        reset()
        onOpenChange(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>장소 추가</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">이름</label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setPlaceId(null)
                setLat(null)
                setLng(null)
                setAddress(null)
              }}
              placeholder="예: 두오모 (검색해서 선택하면 지도에 표시됩니다)"
            />
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
            {address && <p className="mt-1 text-xs text-muted-foreground">{address}</p>}
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
          <div>
            <label className="mb-1 block text-sm font-medium">도시/지역</label>
            <Select
              items={groupItems}
              value={groupId}
              onValueChange={(value) => setGroupId(value ?? 'new')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">+ 새 그룹</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={String(group.id)}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {groupId === 'new' && (
              <Input
                className="mt-2"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="예: 피렌체"
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">메모</label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? '추가하는 중…' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
