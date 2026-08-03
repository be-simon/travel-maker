import Link from 'next/link'
import { listMyBookmarks } from '@/lib/bookmarks/queries'
import { MapProvider } from '@/components/map/map-provider'
import { Button } from '@/components/ui/button'
import { PlacesLibrary } from './places-library'

// 미인증 접근은 미들웨어가 /login으로 리다이렉트한다 (/places는 PUBLIC_PATHS 아님).
export default async function PlacesPage() {
  const bookmarks = await listMyBookmarks()

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">저장한 장소</h1>
        <Button variant="outline" render={<Link href="/home">내 여행</Link>} />
      </div>
      <MapProvider>
        <PlacesLibrary bookmarks={bookmarks} />
      </MapProvider>
    </main>
  )
}
