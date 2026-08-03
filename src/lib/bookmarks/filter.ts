import type { Bookmark, Spot } from '@/types/database'

export interface BookmarkFilter {
  query: string
  country: string | null
  city: string | null
  category: string | null
}

export function filterBookmarks(bookmarks: Bookmark[], filter: BookmarkFilter): Bookmark[] {
  const query = filter.query.trim().toLowerCase()
  return bookmarks.filter((bookmark) => {
    if (filter.country && bookmark.country !== filter.country) return false
    if (filter.city && bookmark.city !== filter.city) return false
    if (filter.category && bookmark.category !== filter.category) return false
    if (!query) return true
    return [bookmark.name, bookmark.address, bookmark.memo].some(
      (field) => field?.toLowerCase().includes(query) ?? false
    )
  })
}

// 이 여행에 이미 담긴 북마크인지: 복사 시 남긴 bookmark_id(provenance) 또는
// 같은 place_id로 판정한다. 직접 입력으로 이미 추가된 같은 장소도 잡기 위함.
export function isBookmarkImported(
  bookmark: Bookmark,
  spots: Pick<Spot, 'bookmark_id' | 'place_id'>[]
): boolean {
  return spots.some(
    (spot) =>
      spot.bookmark_id === bookmark.id ||
      (bookmark.place_id !== null && spot.place_id === bookmark.place_id)
  )
}
