'use client'

import { useEffect, useState, useTransition } from 'react'
import { createBlock, updateBlock, deleteBlock } from '@/lib/plan-blocks/actions'
import type { BlockType, PlanBlock, Spot } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTripRealtime } from '@/lib/realtime/trip-realtime'

const TYPE_OPTIONS: { value: BlockType; label: string }[] = [
  { value: 'spot', label: '스팟' },
  { value: 'transport', label: '이동' },
  { value: 'lodging', label: '숙소' },
  { value: 'memo', label: '자유 메모' },
]

export interface BlockDraft {
  tripId: number
  date: string
  startTime: string
  endTime: string
  spotId?: number
  title?: string
}

function toDbTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value
}

export function BlockDialog({
  open,
  onOpenChange,
  draft,
  editingBlock,
  spots,
  tripStartDate,
  tripEndDate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: BlockDraft | null
  editingBlock: PlanBlock | null
  spots: Spot[]
  tripStartDate: string
  tripEndDate: string
}) {
  const { markEdited } = useTripRealtime()
  const [title, setTitle] = useState('')
  const [type, setType] = useState<BlockType>('spot')
  const [spotId, setSpotId] = useState<string>('none')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // 다이얼로그가 생성/수정 모드를 오갈 때 폼 필드를 해당 블록(또는 draft)의
  // 값으로 다시 채워야 한다 — 부모가 같은 인스턴스를 재사용하며 open/editingBlock/
  // draft만 갈아끼우므로, 이 동기화는 useEffect 안에서 setState로 처리한다.
  //
  // 의존성 배열에 open을 포함하는 이유: editingBlock/draft는 부모(TimelineView)의
  // blocks prop에서 온 참조라서, "같은 블록을 다시 열기"(취소 후 재클릭 등) 시
  // openEditDialog가 이전과 동일한 참조를 넘기면 React가 Object.is로 상태 갱신을
  // 생략해 이 effect가 재실행되지 않는 문제가 있었다. open은 열 때마다 항상
  // false→true로 바뀌므로(같은 블록을 다시 열어도 마찬가지), open을 의존성에
  // 추가하면 참조 동일성과 무관하게 매번 재동기화된다. (부모 쪽에서 닫을 때
  // editingBlock/draft를 null로 되돌리는 방식도 검토했으나, 그러면 open이
  // false로 바뀌는 것과 같은 렌더에서 tripId가 사라져 `if (!tripId) return null`에
  // 걸려 Dialog가 즉시 언마운트되고 Base UI의 닫힘 애니메이션이 재생되지 않는
  // 부작용이 있어 폐기했다.)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (editingBlock) {
      setTitle(editingBlock.title)
      setType(editingBlock.type)
      setSpotId(editingBlock.spot_id ? String(editingBlock.spot_id) : 'none')
      setDate(editingBlock.date)
      setStartTime(editingBlock.start_time.slice(0, 5))
      // input[type=time]은 24:00을 표현하지 못하므로(빈 값으로 렌더되어 저장이
      // 막힘) 자정 종료 블록은 편집 화면에서 23:59로 표시/저장된다.
      const endHM = editingBlock.end_time.slice(0, 5)
      setEndTime(endHM.startsWith('24:') ? '23:59' : endHM)
      setMemo(editingBlock.memo ?? '')
    } else if (draft) {
      setTitle(draft.title ?? '')
      setType('spot')
      setSpotId(draft.spotId ? String(draft.spotId) : 'none')
      setDate(draft.date)
      setStartTime(draft.startTime)
      setEndTime(draft.endTime)
      setMemo('')
    }
    setError(null)
  }, [editingBlock, draft, open])
  /* eslint-enable react-hooks/set-state-in-effect */

  const tripId = editingBlock?.trip_id ?? draft?.tripId
  if (!tripId) return null

  const spotItems = [
    { value: 'none', label: '연결 안 함' },
    ...spots.map((spot) => ({ value: String(spot.id), label: spot.name })),
  ]

  const submit = () => {
    startTransition(async () => {
      const input = {
        tripId,
        date,
        startTime: toDbTime(startTime),
        endTime: toDbTime(endTime),
        type,
        spotId: type === 'spot' && spotId !== 'none' ? Number(spotId) : null,
        title,
        memo,
        tripStartDate,
        tripEndDate,
      }

      const result = editingBlock
        ? await updateBlock(editingBlock.id, tripId, input)
        : await createBlock(input)

      if (result.error) {
        setError(result.error)
      } else {
        if (editingBlock) markEdited('plan_blocks', editingBlock.id)
        onOpenChange(false)
      }
    })
  }

  const remove = () => {
    if (!editingBlock) return
    startTransition(async () => {
      const result = await deleteBlock(editingBlock.id, editingBlock.trip_id)
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
          <DialogTitle>{editingBlock ? '일정 수정' : '일정 추가'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">제목</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 두오모 투어" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">유형</label>
            <Select
              items={TYPE_OPTIONS}
              value={type}
              onValueChange={(value) => setType(value as BlockType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {type === 'spot' && (
            <div>
              <label className="mb-1 block text-sm font-medium">장소</label>
              <Select
                items={spotItems}
                value={spotId}
                onValueChange={(value) => setSpotId(value ?? 'none')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">연결 안 함</SelectItem>
                  {spots.map((spot) => (
                    <SelectItem key={spot.id} value={String(spot.id)}>
                      {spot.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium">날짜</label>
            <Input
              type="date"
              value={date}
              min={tripStartDate}
              max={tripEndDate}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium">시작</label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium">종료</label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">메모</label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          {editingBlock && (
            <Button variant="destructive" onClick={remove} disabled={isPending}>
              삭제
            </Button>
          )}
          <Button onClick={submit} disabled={isPending}>
            {isPending ? '저장하는 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
