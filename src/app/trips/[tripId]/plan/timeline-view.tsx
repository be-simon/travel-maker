'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { PlanBlock, Spot, SpotGroup } from '@/types/database'
import { updateBlock, type BlockInput } from '@/lib/plan-blocks/actions'
import { useTripRealtime } from '@/lib/realtime/trip-realtime'
import { minutesToTime, timeToMinutes } from '@/lib/today/engine'
import {
  DAY_MINUTES,
  dragCreateRange,
  moveRange,
  pxToMinutes,
  resizeRange,
} from '@/lib/timeline/grid'
import { travelHints } from '@/lib/timeline/travel-hints'
import { cityHeaderSpans } from '@/lib/timeline/city-header'
import { BlockDialog, type BlockDraft } from './block-dialog'

const SLOT_MINUTES = 30
const SLOTS_PER_DAY = DAY_MINUTES / SLOT_MINUTES
const PX_PER_SLOT = 28
const PX_PER_MINUTE = PX_PER_SLOT / SLOT_MINUTES
const CLICK_THRESHOLD_PX = 4
const DEFAULT_CREATE_MINUTES = 60

const TYPE_LABELS: Record<string, string> = {
  spot: '스팟',
  transport: '이동',
  lodging: '숙소',
  memo: '메모',
}

const TYPE_COLORS: Record<string, string> = {
  spot: 'bg-blue-100 border-blue-300 text-blue-900',
  transport: 'bg-amber-100 border-amber-300 text-amber-900',
  lodging: 'bg-purple-100 border-purple-300 text-purple-900',
  memo: 'bg-gray-100 border-gray-300 text-gray-900',
}

const TYPE_BAR_COLORS: Record<string, string> = {
  spot: 'bg-blue-400',
  transport: 'bg-amber-400',
  lodging: 'bg-purple-400',
  memo: 'bg-gray-400',
}

export function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  // UTC로 파싱/증가시켜야 한다: 'T00:00:00'(타임존 없음)을 로컬 자정으로 파싱한
  // 뒤 toISOString()(UTC)으로 읽으면, UTC+ 타임존(한국 등)에서 모든 날짜가
  // 하루씩 앞으로 밀린다 — 마지막 날짜 컬럼이 통째로 사라지는 버그로 이어짐.
  const cursor = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

interface LaidOutBlock extends PlanBlock {
  column: number
  columnCount: number
}

// 그리디 컬럼 배정: 시작 시간순으로 정렬한 뒤, 각 블록을 "마지막 블록이 이미
// 끝난" 첫 번째 기존 컬럼에 넣고, 없으면 새 컬럼을 만든다. 겹치는 블록들은
// 서로 다른 컬럼에 들어가 나란히 배치된다.
function layoutDayBlocks(blocks: PlanBlock[]): LaidOutBlock[] {
  const sorted = [...blocks].sort((a, b) => a.start_time.localeCompare(b.start_time))
  const columns: PlanBlock[][] = []

  for (const block of sorted) {
    let placed = false
    for (const column of columns) {
      const last = column[column.length - 1]
      if (last.end_time <= block.start_time) {
        column.push(block)
        placed = true
        break
      }
    }
    if (!placed) columns.push([block])
  }

  const columnCount = columns.length || 1
  const result: LaidOutBlock[] = []
  columns.forEach((column, columnIndex) => {
    column.forEach((block) => {
      result.push({ ...block, column: columnIndex, columnCount })
    })
  })
  return result
}

// moved: 클릭 임계값(CLICK_THRESHOLD_PX)을 넘어 실제로 움직였는지 여부. 렌더
// 중에는 ref가 아니라 이 state 필드만 읽어야 하므로(react-hooks/refs), 포인터
// 이동 핸들러가 dragMovedRef와 함께 이 필드도 갱신해 둔다.
type DragState =
  | { kind: 'create'; date: string; columnTop: number; anchorPx: number; currentPx: number; moved: boolean }
  | { kind: 'move'; block: PlanBlock; startClientY: number; deltaPx: number; moved: boolean }
  | {
      kind: 'resize'
      block: PlanBlock
      edge: 'top' | 'bottom'
      startClientY: number
      deltaPx: number
      moved: boolean
    }

function toDbTime(hhmm: string): string {
  return `${hhmm}:00`
}

function blockToInput(
  block: PlanBlock,
  startHHMM: string,
  endHHMM: string,
  tripStartDate: string,
  tripEndDate: string
): Omit<BlockInput, 'tripId'> {
  return {
    date: block.date,
    startTime: toDbTime(startHHMM),
    endTime: toDbTime(endHHMM),
    type: block.type,
    spotId: block.spot_id,
    title: block.title,
    memo: block.memo ?? '',
    tripStartDate,
    tripEndDate,
  }
}

export function TimelineView({
  tripId,
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
  const dates = enumerateDates(startDate, endDate)
  const spotById = new Map(spots.map((spot) => [spot.id, spot]))
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]))
  const dayHeight = SLOTS_PER_DAY * PX_PER_SLOT
  const { markEdited } = useTripRealtime()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<BlockDraft | null>(null)
  const [editingBlock, setEditingBlock] = useState<PlanBlock | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [pendingTimes, setPendingTimes] = useState<
    Record<number, { start: string; end: string }>
  >({})
  const [, startTransition] = useTransition()

  const dragRef = useRef<DragState | null>(null)
  const dragMovedRef = useRef(false)

  // 서버 revalidate로 새 blocks prop이 내려오면 낙관적 오버라이드를 걷어낸다 —
  // 이 시점의 서버 상태가 곧 최종(LWW)이므로 남겨두면 오히려 어긋난다.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPendingTimes({})
  }, [blocks])
  /* eslint-enable react-hooks/set-state-in-effect */

  const adjustedBlocks = blocks.map((block) => {
    const pending = pendingTimes[block.id]
    return pending ? { ...block, start_time: pending.start, end_time: pending.end } : block
  })

  const spans = cityHeaderSpans(dates, adjustedBlocks, spotById, groupNameById)
  const spanAt = (index: number) =>
    spans.find((span) => index >= span.startIndex && index < span.startIndex + span.length)

  const beginDrag = (state: DragState) => {
    dragRef.current = state
    dragMovedRef.current = false
    setDrag(state)
  }

  const openCreateDialog = (date: string, startMin: number, endMin: number) => {
    setDraft({
      tripId,
      date,
      startTime: minutesToTime(startMin),
      // input[type=time]은 24:00을 표현하지 못한다 — 자정까지 드래그한 경우
      // 23:59로 보여준다 (block-dialog의 편집 브랜치와 같은 처리).
      endTime: endMin >= DAY_MINUTES ? '23:59' : minutesToTime(endMin),
    })
    setEditingBlock(null)
    setDialogOpen(true)
  }

  const openEditDialog = (block: PlanBlock) => {
    setEditingBlock(block)
    setDraft(null)
    setDialogOpen(true)
  }

  const commitTimes = (block: PlanBlock, startMin: number, endMin: number, message: string) => {
    const start = minutesToTime(startMin)
    const end = minutesToTime(endMin)
    if (toDbTime(start) === block.start_time && toDbTime(end) === block.end_time) return

    const prevStart = block.start_time.slice(0, 5)
    const prevEnd = block.end_time.slice(0, 5)
    setPendingTimes((prev) => ({
      ...prev,
      [block.id]: { start: toDbTime(start), end: toDbTime(end) },
    }))

    startTransition(async () => {
      const result = await updateBlock(
        block.id,
        tripId,
        blockToInput(block, start, end, startDate, endDate)
      )
      if (result.error) {
        toast.error(result.error)
        setPendingTimes((prev) => {
          const next = { ...prev }
          delete next[block.id]
          return next
        })
        return
      }
      markEdited('plan_blocks', block.id)
      toast(message, {
        action: {
          label: '실행 취소',
          onClick: () => {
            startTransition(async () => {
              const undo = await updateBlock(
                block.id,
                tripId,
                blockToInput(block, prevStart, prevEnd, startDate, endDate)
              )
              if (undo.error) toast.error(undo.error)
              else markEdited('plan_blocks', block.id)
            })
          },
        },
      })
    })
  }

  // 드래그 중에는 window 레벨에서 pointermove/up을 받는다 — 포인터가 컬럼/블록
  // 밖으로 나가도 추적이 끊기지 않게 하기 위함. drag 상태가 있을 때만 부착.
  // (openCreateDialog 등 렌더 스코프 함수를 쓰지만, drag가 바뀔 때마다 이 effect가
  // 재실행되어 클로저가 갱신되므로 stale 값 문제가 없다.)
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!drag) return

    const onPointerMove = (event: PointerEvent) => {
      const current = dragRef.current
      if (!current) return
      let next: DragState
      if (current.kind === 'create') {
        const currentPx = event.clientY - current.columnTop
        if (Math.abs(currentPx - current.anchorPx) > CLICK_THRESHOLD_PX) {
          dragMovedRef.current = true
        }
        next = { ...current, currentPx, moved: dragMovedRef.current }
      } else {
        const deltaPx = event.clientY - current.startClientY
        if (Math.abs(deltaPx) > CLICK_THRESHOLD_PX) dragMovedRef.current = true
        next = { ...current, deltaPx, moved: dragMovedRef.current }
      }
      dragRef.current = next
      setDrag(next)
    }

    const onPointerUp = () => {
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!current) return

      if (current.kind === 'create') {
        if (dragMovedRef.current) {
          const range = dragCreateRange(current.anchorPx, current.currentPx, PX_PER_MINUTE)
          openCreateDialog(current.date, range.startMin, range.endMin)
        } else {
          const startMin = Math.min(
            pxToMinutes(current.anchorPx, PX_PER_MINUTE),
            DAY_MINUTES - DEFAULT_CREATE_MINUTES
          )
          openCreateDialog(current.date, startMin, startMin + DEFAULT_CREATE_MINUTES)
        }
        return
      }

      if (!dragMovedRef.current) {
        openEditDialog(current.block)
        return
      }

      const startMin = timeToMinutes(current.block.start_time)
      const endMin = timeToMinutes(current.block.end_time)
      if (current.kind === 'move') {
        const range = moveRange(startMin, endMin, current.deltaPx, PX_PER_MINUTE)
        commitTimes(current.block, range.startMin, range.endMin, '일정을 이동했어요')
      } else {
        const range = resizeRange(startMin, endMin, current.edge, current.deltaPx, PX_PER_MINUTE)
        commitTimes(current.block, range.startMin, range.endMin, '블록 길이를 조절했어요')
      }
    }

    const onPointerCancel = () => {
      dragRef.current = null
      setDrag(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [drag])
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <>
      {/* 데스크톱: 드래그 편집 그리드 */}
      <div className="hidden overflow-x-auto rounded-lg border md:flex">
        {dates.map((date, dateIndex) => {
          const rawDayBlocks = adjustedBlocks.filter((block) => block.date === date)
          const dayBlocks = layoutDayBlocks(rawDayBlocks)
          const hints = travelHints(rawDayBlocks, spotById)
          const span = spanAt(dateIndex)
          const cityHeader =
            span && span.label != null && dateIndex === span.startIndex
              ? `${span.label} · ${span.length}일`
              : ''

          return (
            <div key={date} className="w-56 shrink-0 border-r last:border-r-0">
              <div className="h-6 truncate border-b bg-muted/30 px-2 text-[11px] leading-6 text-muted-foreground">
                {cityHeader}
              </div>
              <div className="border-b bg-muted/50 p-2 text-center text-sm font-medium">{date}</div>
              <div
                className="relative cursor-pointer touch-none"
                style={{
                  height: dayHeight,
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${PX_PER_SLOT}px)`,
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  const anchorPx = event.clientY - rect.top
                  beginDrag({
                    kind: 'create',
                    date,
                    columnTop: rect.top,
                    anchorPx,
                    currentPx: anchorPx,
                    moved: false,
                  })
                }}
              >
                {dayBlocks.map((block) => {
                  let startMin = timeToMinutes(block.start_time)
                  let endMin = timeToMinutes(block.end_time)
                  // isDragTarget을 boolean 변수로 빼면 TS가 아래에서 drag를 좁히지
                  // 못하므로, 판별은 drag를 직접 검사하는 형태로 쓴다.
                  const isDragTarget =
                    drag != null && drag.kind !== 'create' && drag.block.id === block.id
                  if (drag && drag.kind === 'move' && drag.block.id === block.id && drag.moved) {
                    const range = moveRange(startMin, endMin, drag.deltaPx, PX_PER_MINUTE)
                    startMin = range.startMin
                    endMin = range.endMin
                  } else if (
                    drag &&
                    drag.kind === 'resize' &&
                    drag.block.id === block.id &&
                    drag.moved
                  ) {
                    const range = resizeRange(startMin, endMin, drag.edge, drag.deltaPx, PX_PER_MINUTE)
                    startMin = range.startMin
                    endMin = range.endMin
                  }

                  const widthPercent = 100 / block.columnCount
                  const spot = block.spot_id ? spotById.get(block.spot_id) : null

                  return (
                    <div
                      key={block.id}
                      className={`absolute overflow-hidden rounded border p-1 text-xs ${TYPE_COLORS[block.type]} ${
                        isDragTarget ? 'z-10 opacity-80 shadow-md' : ''
                      }`}
                      style={{
                        top: startMin * PX_PER_MINUTE,
                        height: (endMin - startMin) * PX_PER_MINUTE,
                        left: `${block.column * widthPercent}%`,
                        width: `${widthPercent}%`,
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        if (event.button !== 0) return
                        beginDrag({ kind: 'move', block, startClientY: event.clientY, deltaPx: 0, moved: false })
                      }}
                    >
                      <div
                        className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          if (event.button !== 0) return
                          beginDrag({
                            kind: 'resize',
                            block,
                            edge: 'top',
                            startClientY: event.clientY,
                            deltaPx: 0,
                            moved: false,
                          })
                        }}
                      />
                      <div className="font-medium">{block.title}</div>
                      <div className="text-[10px] opacity-70">
                        {minutesToTime(startMin)}–{minutesToTime(endMin)} · {TYPE_LABELS[block.type]}
                      </div>
                      {spot && <div className="text-[10px] opacity-70">{spot.name}</div>}
                      <div
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          if (event.button !== 0) return
                          beginDrag({
                            kind: 'resize',
                            block,
                            edge: 'bottom',
                            startClientY: event.clientY,
                            deltaPx: 0,
                            moved: false,
                          })
                        }}
                      />
                    </div>
                  )
                })}

                {hints.map((hint) => (
                  <div
                    key={`${hint.fromBlockId}-${hint.toBlockId}`}
                    className="pointer-events-none absolute right-1 z-10 -translate-y-full rounded bg-background/90 px-1 text-[10px] text-muted-foreground shadow-sm"
                    style={{ top: hint.boundaryMin * PX_PER_MINUTE }}
                  >
                    이동 ~{hint.walkMin}분
                  </div>
                ))}

                {drag?.kind === 'create' && drag.date === date && drag.moved && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 rounded border-2 border-dashed border-blue-400/70 bg-blue-100/40"
                    style={{
                      top: dragCreateRange(drag.anchorPx, drag.currentPx, PX_PER_MINUTE).startMin * PX_PER_MINUTE,
                      height:
                        (dragCreateRange(drag.anchorPx, drag.currentPx, PX_PER_MINUTE).endMin -
                          dragCreateRange(drag.anchorPx, drag.currentPx, PX_PER_MINUTE).startMin) *
                        PX_PER_MINUTE,
                    }}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-1 hidden text-[11px] text-muted-foreground md:block">
        드래그로 생성·이동·길이 조절 (15분 단위) · 이동 시간은 직선거리 기반 추정
      </p>

      {/* 모바일: 일 단위 세로 리스트 (PRD F4) */}
      <div className="space-y-4 md:hidden">
        {dates.map((date, dateIndex) => {
          const dayBlocks = adjustedBlocks
            .filter((block) => block.date === date)
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
          const hints = travelHints(dayBlocks, spotById)
          const hintByFromId = new Map(hints.map((hint) => [hint.fromBlockId, hint]))
          const cityLabel = spanAt(dateIndex)?.label

          return (
            <section key={date} className="rounded-lg border">
              <header className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
                <span className="text-sm font-medium">
                  {date}
                  {cityLabel ? ` · ${cityLabel}` : ''}
                </span>
                <button
                  type="button"
                  className="min-h-11 text-xs text-muted-foreground"
                  onClick={() => openCreateDialog(date, 9 * 60, 10 * 60)}
                >
                  + 일정 추가
                </button>
              </header>
              {dayBlocks.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">일정 없음</p>
              ) : (
                <ul>
                  {dayBlocks.map((block) => {
                    const spot = block.spot_id ? spotById.get(block.spot_id) : null
                    const hint = hintByFromId.get(block.id)
                    return (
                      <li key={block.id} className="border-b last:border-b-0">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left"
                          onClick={() => openEditDialog(block)}
                        >
                          <span className={`h-8 w-1 shrink-0 rounded ${TYPE_BAR_COLORS[block.type]}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{block.title}</span>
                            <span className="block text-xs text-muted-foreground">
                              {block.start_time.slice(0, 5)}–{block.end_time.slice(0, 5)} ·{' '}
                              {TYPE_LABELS[block.type]}
                              {spot ? ` · ${spot.name}` : ''}
                            </span>
                          </span>
                        </button>
                        {hint && (
                          <p className="px-3 pb-2 text-[11px] text-muted-foreground">
                            ↓ 이동 ~{hint.walkMin}분 (직선거리 기준)
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      <BlockDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        draft={draft}
        editingBlock={editingBlock}
        spots={spots}
        tripStartDate={startDate}
        tripEndDate={endDate}
      />
    </>
  )
}
