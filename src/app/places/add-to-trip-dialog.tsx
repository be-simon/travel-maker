'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { importBookmarks } from '@/lib/bookmarks/actions'
import type { Bookmark, Trip } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// PRD F3: 저장한 장소를 여행에 담으면 여행 전용 장소(스팟) 복사본이 생긴다.
// 플랜 화면의 가져오기(import-bookmarks-dialog)와 같은 액션을 개별 북마크에
// 대해 /places에서 바로 쓸 수 있게 한 진입점.
export function AddToTripDialog({
  open,
  onOpenChange,
  bookmark,
  trips,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookmark: Bookmark | null
  trips: Trip[]
}) {
  const [pendingTripId, setPendingTripId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 다이얼로그를 닫았다가 다른 북마크로 다시 열면 진행 중이던 담기 요청은 무시한다 —
  // 이전 북마크의 응답이 새로 연 다이얼로그의 pending/에러 상태나 닫힘을 덮어쓰지 않게
  // open/close 전환마다 세션을 증가시킨다 (link-import-dialog와 동일한 패턴).
  const sessionRef = useRef(0)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    sessionRef.current += 1
    if (open) {
      setPendingTripId(null)
      setError(null)
    }
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  const add = (trip: Trip) => {
    if (!bookmark) return
    const session = sessionRef.current
    setError(null)
    setPendingTripId(trip.id)
    void (async () => {
      const result = await importBookmarks(trip.id, [bookmark.id])
      if (sessionRef.current !== session) return
      setPendingTripId(null)
      if (result.error) {
        setError(result.error)
      } else {
        toast(`'${trip.title}'에 담았어요`)
        onOpenChange(false)
      }
    })()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{bookmark ? `'${bookmark.name}' 여행에 담기` : '여행에 담기'}</DialogTitle>
        </DialogHeader>
        {trips.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            아직 여행이 없습니다. 홈에서 여행을 먼저 만들어 주세요.
          </p>
        ) : (
          <ul className="space-y-2">
            {trips.map((trip) => (
              <li key={trip.id}>
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  disabled={pendingTripId !== null}
                  onClick={() => add(trip)}
                >
                  <span className="truncate">{trip.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {pendingTripId === trip.id ? '담는 중…' : `${trip.start_date} – ${trip.end_date}`}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
