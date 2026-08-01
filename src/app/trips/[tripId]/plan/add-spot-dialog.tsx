'use client'

import { useState, useTransition } from 'react'
import { createSpot } from '@/lib/spots/actions'
import type { SpotCategory, SpotGroup } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const CATEGORY_OPTIONS: { value: SpotCategory; label: string }[] = [
  { value: 'sight', label: '관광' },
  { value: 'restaurant', label: '식당' },
  { value: 'cafe', label: '카페' },
  { value: 'shopping', label: '쇼핑' },
  { value: 'lodging', label: '숙소' },
  { value: 'etc', label: '기타' },
]

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

  const reset = () => {
    setName('')
    setCategory('sight')
    setGroupId('new')
    setNewGroupName('')
    setMemo('')
    setError(null)
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
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 두오모" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">카테고리</label>
            <Select value={category} onValueChange={(value) => setCategory(value as SpotCategory)}>
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
            <Select value={groupId} onValueChange={(value) => setGroupId(value ?? 'new')}>
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
