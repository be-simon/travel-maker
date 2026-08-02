'use client'

import { useState } from 'react'
import type { PlanBlock, Spot } from '@/types/database'
import { BlockDialog, type BlockDraft } from './block-dialog'

const SLOT_MINUTES = 30
const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES
const PX_PER_SLOT = 28

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

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minutesToPx(minutes: number): number {
  return (minutes / SLOT_MINUTES) * PX_PER_SLOT
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

function pxToTime(px: number): string {
  const totalMinutes = Math.round(px / PX_PER_SLOT) * SLOT_MINUTES
  const clamped = Math.max(0, Math.min(totalMinutes, 24 * 60 - SLOT_MINUTES))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function addMinutesToTime(time: string, minutesToAdd: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = Math.min(h * 60 + m + minutesToAdd, 24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function TimelineView({
  tripId,
  startDate,
  endDate,
  blocks,
  spots,
}: {
  tripId: number
  startDate: string
  endDate: string
  blocks: PlanBlock[]
  spots: Spot[]
}) {
  const dates = enumerateDates(startDate, endDate)
  const spotById = new Map(spots.map((spot) => [spot.id, spot]))
  const dayHeight = SLOTS_PER_DAY * PX_PER_SLOT

  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<BlockDraft | null>(null)
  const [editingBlock, setEditingBlock] = useState<PlanBlock | null>(null)

  const openCreateDialog = (date: string, event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const offsetY = event.clientY - rect.top
    const startTime = pxToTime(offsetY)
    setDraft({ tripId, date, startTime, endTime: addMinutesToTime(startTime, 60) })
    setEditingBlock(null)
    setDialogOpen(true)
  }

  const openEditDialog = (block: PlanBlock, event: React.MouseEvent) => {
    event.stopPropagation()
    setEditingBlock(block)
    setDraft(null)
    setDialogOpen(true)
  }

  return (
    <>
      <div className="flex overflow-x-auto rounded-lg border">
        {dates.map((date) => {
          const dayBlocks = layoutDayBlocks(blocks.filter((block) => block.date === date))

          return (
            <div key={date} className="w-56 shrink-0 border-r last:border-r-0">
              <div className="border-b bg-muted/50 p-2 text-center text-sm font-medium">{date}</div>
              <div
                className="relative cursor-pointer"
                style={{
                  height: dayHeight,
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${PX_PER_SLOT}px)`,
                }}
                onClick={(event) => openCreateDialog(date, event)}
              >
                {dayBlocks.map((block) => {
                  const top = minutesToPx(timeToMinutes(block.start_time))
                  const height = minutesToPx(timeToMinutes(block.end_time) - timeToMinutes(block.start_time))
                  const widthPercent = 100 / block.columnCount
                  const spot = block.spot_id ? spotById.get(block.spot_id) : null

                  return (
                    <div
                      key={block.id}
                      className={`absolute overflow-hidden rounded border p-1 text-xs ${TYPE_COLORS[block.type]}`}
                      style={{
                        top,
                        height,
                        left: `${block.column * widthPercent}%`,
                        width: `${widthPercent}%`,
                      }}
                      onClick={(event) => openEditDialog(block, event)}
                    >
                      <div className="font-medium">{block.title}</div>
                      <div className="text-[10px] opacity-70">
                        {block.start_time.slice(0, 5)}–{block.end_time.slice(0, 5)} · {TYPE_LABELS[block.type]}
                      </div>
                      {spot && <div className="text-[10px] opacity-70">{spot.name}</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <BlockDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        draft={draft}
        editingBlock={editingBlock}
        spots={spots}
      />
    </>
  )
}
