'use client'

import { useEffect, useState, useTransition } from 'react'
import { importBookmarks } from '@/lib/bookmarks/actions'
import { filterBookmarks, isBookmarkImported } from '@/lib/bookmarks/filter'
import type { Bookmark, Spot } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

// 계정 라이브러리(저장한 장소)에서 골라 이 여행의 장소(스팟)로 복사한다.
// 이미 담긴 항목(bookmark_id 또는 place_id 일치)은 비활성 + "담김" 표시.
export function ImportBookmarksDialog({
  tripId,
  bookmarks,
  spots,
  open,
  onOpenChange,
}: {
  tripId: number
  bookmarks: Bookmark[]
  spots: Spot[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(new Set())
      setError(null)
    }
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  const visible = filterBookmarks(bookmarks, { query, country: null, city: null, category: null })

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = () => {
    startTransition(async () => {
      const result = await importBookmarks(tripId, [...selected])
      if (result.error) setError(result.error)
      else onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>저장한 장소에서 담기</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·주소·메모 검색" />
          {bookmarks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              저장한 장소가 없습니다. 저장한 장소 화면에서 먼저 추가해 주세요.
            </p>
          )}
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {visible.map((bookmark) => {
              const imported = isBookmarkImported(bookmark, spots)
              return (
                <li key={bookmark.id}>
                  <label
                    className={`flex items-center gap-2 rounded border p-2 text-sm ${
                      imported ? 'text-muted-foreground' : 'cursor-pointer hover:bg-accent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={imported}
                      checked={selected.has(bookmark.id)}
                      onChange={() => toggle(bookmark.id)}
                    />
                    <span className="flex-1">{bookmark.name}</span>
                    {imported ? (
                      <span className="text-xs">담김</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {[bookmark.city, bookmark.country].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={isPending || selected.size === 0}>
            {isPending ? '담는 중…' : `${selected.size}개 담기`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
