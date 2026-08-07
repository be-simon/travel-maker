'use client'

import { useState, useTransition } from 'react'
import type { Bookmark, Trip } from '@/types/database'
import { deleteBookmark } from '@/lib/bookmarks/actions'
import { filterBookmarks } from '@/lib/bookmarks/filter'
import { CATEGORY_LABELS, CATEGORY_OPTIONS } from '@/lib/spot-categories'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AddToTripDialog } from './add-to-trip-dialog'
import { BookmarkDialog } from './bookmark-dialog'
import { LinkImportDialog } from './link-import-dialog'

type DialogState =
  | { mode: 'closed' }
  | { mode: 'add' }
  | { mode: 'link' }
  | { mode: 'edit'; bookmark: Bookmark }
  | { mode: 'addToTrip'; bookmark: Bookmark }

function uniqueValues(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))].sort()
}

function FilterChips({
  label,
  values,
  active,
  onToggle,
}: {
  label: string
  values: { value: string; label: string }[]
  active: string | null
  onToggle: (value: string | null) => void
}) {
  if (values.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {values.map(({ value, label: chipLabel }) => (
        <button
          key={value}
          type="button"
          className={`rounded-full border px-2.5 py-0.5 text-xs ${
            active === value ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'
          }`}
          onClick={() => onToggle(active === value ? null : value)}
        >
          {chipLabel}
        </button>
      ))}
    </div>
  )
}

export function PlacesLibrary({ bookmarks, trips }: { bookmarks: Bookmark[]; trips: Trip[] }) {
  const [query, setQuery] = useState('')
  const [country, setCountry] = useState<string | null>(null)
  const [city, setCity] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const countries = uniqueValues(bookmarks.map((bookmark) => bookmark.country))
  // 국가 칩을 고르면 도시 칩은 그 국가의 도시로 좁힌다.
  const cities = uniqueValues(
    bookmarks
      .filter((bookmark) => !country || bookmark.country === country)
      .map((bookmark) => bookmark.city)
  )
  const usedCategories = new Set(bookmarks.map((bookmark) => bookmark.category))

  const visible = filterBookmarks(bookmarks, { query, country, city, category })

  const remove = (bookmark: Bookmark) => {
    if (!confirm(`'${bookmark.name}'을(를) 삭제할까요?`)) return
    startTransition(async () => {
      const result = await deleteBookmark(bookmark.id)
      setError(result.error)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름·주소·메모 검색"
        />
        <Button className="shrink-0" onClick={() => setDialog({ mode: 'add' })}>
          + 장소 저장
        </Button>
        <Button variant="outline" className="shrink-0" onClick={() => setDialog({ mode: 'link' })}>
          링크로 저장
        </Button>
      </div>

      <div className="space-y-1.5">
        <FilterChips
          label="국가"
          values={countries.map((value) => ({ value, label: value }))}
          active={country}
          onToggle={(value) => {
            setCountry(value)
            setCity(null)
          }}
        />
        <FilterChips
          label="도시"
          values={cities.map((value) => ({ value, label: value }))}
          active={city}
          onToggle={setCity}
        />
        <FilterChips
          label="분류"
          values={CATEGORY_OPTIONS.filter((option) => usedCategories.has(option.value)).map(
            (option) => ({ value: option.value, label: option.label })
          )}
          active={category}
          onToggle={setCategory}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {bookmarks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          아직 저장한 장소가 없습니다. 가고 싶은 곳을 저장해 두면 어느 여행에서든 꺼내 쓸 수
          있어요.
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">검색·필터에 맞는 장소가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((bookmark) => (
            <li key={bookmark.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{bookmark.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {[
                      CATEGORY_LABELS[bookmark.category],
                      [bookmark.city, bookmark.country].filter(Boolean).join(', ') || null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {bookmark.address && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{bookmark.address}</div>
                  )}
                  {bookmark.memo && <div className="mt-1 text-sm">{bookmark.memo}</div>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ mode: 'addToTrip', bookmark })}
                  >
                    여행에 담기
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ mode: 'edit', bookmark })}
                  >
                    수정
                  </Button>
                  <Button variant="outline" size="sm" disabled={isPending} onClick={() => remove(bookmark)}>
                    삭제
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <BookmarkDialog
        open={dialog.mode === 'add' || dialog.mode === 'edit'}
        onOpenChange={(open) => {
          if (!open) setDialog({ mode: 'closed' })
        }}
        editing={dialog.mode === 'edit' ? dialog.bookmark : null}
        existing={bookmarks}
      />
      <LinkImportDialog
        open={dialog.mode === 'link'}
        onOpenChange={(open) => {
          if (!open) setDialog({ mode: 'closed' })
        }}
        existing={bookmarks}
      />
      <AddToTripDialog
        open={dialog.mode === 'addToTrip'}
        onOpenChange={(open) => {
          if (!open) setDialog({ mode: 'closed' })
        }}
        bookmark={dialog.mode === 'addToTrip' ? dialog.bookmark : null}
        trips={trips}
      />
    </div>
  )
}
