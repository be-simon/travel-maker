'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { PlanBlock, Spot, Trip } from '@/types/database'
import { Button } from '@/components/ui/button'
import { createBlock, shiftBlock } from '@/lib/plan-blocks/actions'
import {
  directionsUrl,
  findCurrentBlock,
  findInsertSlot,
  findNextBlock,
  localDateString,
  recommendSpots,
  resolveAnchor,
  timeToMinutes,
  type Recommendation,
} from '@/lib/today/engine'

const TYPE_LABELS: Record<string, string> = {
  spot: '스팟',
  transport: '이동',
  lodging: '숙소',
  memo: '메모',
}

const ANCHOR_SOURCE_LABELS: Record<string, string> = {
  current: '진행 중인 일정',
  past: '직전 일정',
  lodging: '오늘 숙소',
}

const MAX_RECOMMENDATIONS = 8

function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function TodayView({ trip, spots, blocks }: { trip: Trip; spots: Spot[]; blocks: PlanBlock[] }) {
  const router = useRouter()
  const [now, setNow] = useState(() => new Date())
  const [syncedAt, setSyncedAt] = useState(() => new Date())
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const today = localDateString(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const inTripPeriod = trip.start_date <= today && today <= trip.end_date

  const todayBlocks = blocks
    .filter((block) => block.date === today)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))

  const currentBlock = findCurrentBlock(todayBlocks, nowMinutes)
  const nextBlock = findNextBlock(todayBlocks, nowMinutes)
  const anchor = resolveAnchor(todayBlocks, spots, nowMinutes)
  const recommendations = anchor
    ? recommendSpots(spots, todayBlocks, anchor, nowMinutes).slice(0, MAX_RECOMMENDATIONS)
    : []
  const remainingToNext = nextBlock ? timeToMinutes(nextBlock.start_time) - nowMinutes : null
  const spotById = new Map(spots.map((spot) => [spot.id, spot]))

  const refresh = () => {
    router.refresh()
    setSyncedAt(new Date())
    setNow(new Date())
  }

  const addToToday = (rec: Recommendation) => {
    setError(null)
    startTransition(async () => {
      const slot = findInsertSlot(todayBlocks, nowMinutes)
      if (!slot) {
        setError('오늘 남은 빈 시간이 없어 일정을 추가할 수 없습니다.')
        return
      }
      const result = await createBlock({
        tripId: trip.id,
        date: today,
        startTime: `${slot.startTime}:00`,
        endTime: `${slot.endTime}:00`,
        type: 'spot',
        spotId: rec.spot.id,
        title: rec.spot.name,
        memo: '',
        tripStartDate: trip.start_date,
        tripEndDate: trip.end_date,
      })
      if (result.error) setError(result.error)
      else setSyncedAt(new Date())
    })
  }

  const shift = (block: PlanBlock, deltaMinutes: number) => {
    setError(null)
    startTransition(async () => {
      const result = await shiftBlock(block.id, trip.id, deltaMinutes)
      if (result.error) setError(result.error)
      else setSyncedAt(new Date())
    })
  }

  if (!inTripPeriod) {
    return (
      <section className="mx-auto max-w-md space-y-4 text-center">
        <p className="text-muted-foreground">
          오늘({today})은 여행 기간({trip.start_date} – {trip.end_date})이 아닙니다.
        </p>
        <Button variant="outline" render={<Link href={`/trips/${trip.id}/plan`}>플랜 보기</Link>} />
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-md space-y-6 pb-24">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{today}</h2>
          <p className="text-xs text-muted-foreground">마지막 동기화 {formatClock(syncedAt)}</p>
        </div>
      </header>

      <div className="space-y-2">
        <div className="rounded-lg border p-4">
          <p className="text-xs font-medium text-muted-foreground">현재 일정</p>
          {currentBlock ? (
            <p className="mt-1 font-medium">
              {currentBlock.title}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {currentBlock.start_time.slice(0, 5)}–{currentBlock.end_time.slice(0, 5)}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">진행 중인 일정이 없습니다.</p>
          )}
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs font-medium text-muted-foreground">다음 일정</p>
          {nextBlock ? (
            <p className="mt-1 font-medium">
              {nextBlock.title}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {nextBlock.start_time.slice(0, 5)} 시작 · {remainingToNext}분 남음
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">오늘 남은 일정이 없습니다.</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">오늘 일정</h3>
        {todayBlocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">오늘 배치된 일정이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {todayBlocks.map((block) => {
              const spot = block.spot_id ? spotById.get(block.spot_id) : null
              const mapUrl = spot ? directionsUrl(spot) : null
              return (
                <li key={block.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{block.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {block.start_time.slice(0, 5)}–{block.end_time.slice(0, 5)} ·{' '}
                        {TYPE_LABELS[block.type]}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        className="min-h-11 px-3"
                        disabled={isPending}
                        onClick={() => shift(block, -15)}
                      >
                        −15분
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-11 px-3"
                        disabled={isPending}
                        onClick={() => shift(block, 15)}
                      >
                        +15분
                      </Button>
                    </div>
                  </div>
                  {mapUrl && (
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex min-h-11 items-center text-sm text-blue-700 underline underline-offset-2"
                    >
                      길찾기 ↗
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium">지금 갈 만한 곳</h3>
        {anchor ? (
          <p className="mb-2 text-xs text-muted-foreground">
            기준: {ANCHOR_SOURCE_LABELS[anchor.source]} · {anchor.label} — 거리는 직선거리 기준
            추정이라 실제 경로와 다를 수 있어요.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            기준점을 잡을 오늘 일정이 없어 추천을 만들 수 없습니다. 플랜에서 일정을 먼저
            배치해 보세요.
          </p>
        )}
        {anchor && recommendations.length === 0 && (
          <p className="text-sm text-muted-foreground">추천할 미방문 후보가 없습니다.</p>
        )}
        <ul className="space-y-2">
          {recommendations.map((rec) => {
            const mapUrl = directionsUrl(rec.spot)
            return (
              <li key={rec.spot.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 truncate font-medium">{rec.spot.name}</p>
                  {rec.spot.priority && <span aria-label="우선순위">★</span>}
                  {!rec.fitsBeforeNext && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
                      다음 일정 전엔 빠듯해요
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {rec.distanceKm.toFixed(1)}km · 도보 약 {rec.walkMin}분
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    className="min-h-11 flex-1"
                    disabled={isPending}
                    onClick={() => addToToday(rec)}
                  >
                    오늘 일정에 추가
                  </Button>
                  {mapUrl && (
                    <Button
                      variant="outline"
                      className="min-h-11"
                      render={
                        <a href={mapUrl} target="_blank" rel="noreferrer">
                          길찾기
                        </a>
                      }
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="fixed inset-x-0 bottom-0 border-t bg-background p-3">
        <div className="mx-auto flex max-w-md gap-2">
          <Button className="min-h-11 flex-1" disabled={isPending} onClick={refresh}>
            새로고침
          </Button>
          <Button
            variant="outline"
            className="min-h-11 flex-1"
            render={<Link href={`/trips/${trip.id}/plan`}>플랜 보기</Link>}
          />
        </div>
      </div>
    </section>
  )
}
