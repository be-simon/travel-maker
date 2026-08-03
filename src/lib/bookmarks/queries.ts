import { createClient } from '@/lib/supabase/server'
import type { Bookmark } from '@/types/database'

// RLS(bookmarks_all)가 소유자 격리를 보장하므로 명시적 owner 필터는 두지 않는다
// (spots/trips 쿼리와 동일한 패턴).
export async function listMyBookmarks(): Promise<Bookmark[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('bookmarks')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}
