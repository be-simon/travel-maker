'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { makeKey, pruneEdits, shouldNotifyOverwrite, type EditKey } from './overwrite'

interface TripRealtimeContextValue {
  lastSyncedAt: Date | null
  onlineEmails: string[]
  markEdited: (table: 'plan_blocks' | 'spots', id: number) => void
}

const TripRealtimeContext = createContext<TripRealtimeContextValue>({
  lastSyncedAt: null,
  onlineEmails: [],
  markEdited: () => {},
})

export function useTripRealtime(): TripRealtimeContextValue {
  return useContext(TripRealtimeContext)
}

const REALTIME_TABLES = ['plan_blocks', 'spots', 'spot_groups'] as const
const REFRESH_DEBOUNCE_MS = 300

export function TripRealtimeProvider({
  tripId,
  userId,
  userEmail,
  memberEmailsByUserId,
  children,
}: {
  tripId: number
  userId: string
  userEmail: string
  memberEmailsByUserId: Record<string, string>
  children: React.ReactNode
}) {
  const router = useRouter()
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [onlineEmails, setOnlineEmails] = useState<string[]>([])
  const editsRef = useRef(new Map<EditKey, number>())
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // memberEmailsByUserId는 서버 컴포넌트가 렌더마다 새 객체로 넘기므로 effect
  // 의존성에 넣으면 매 렌더 재구독한다 — ref로 참조만 갈아끼운다.
  const membersRef = useRef(memberEmailsByUserId)
  useEffect(() => {
    membersRef.current = memberEmailsByUserId
  })

  const markEdited = useCallback((table: 'plan_blocks' | 'spots', id: number) => {
    pruneEdits(editsRef.current, Date.now())
    editsRef.current.set(makeKey(table, id), Date.now())
  }, [])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`trip-${tripId}`, {
      config: { private: true, presence: { key: userId } },
    })

    for (const table of REALTIME_TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `trip_id=eq.${tripId}` },
        (payload) => {
          // DELETE는 서버가 트립별로 필터링/RLS 체크를 하지 않는다 (old record에는
          // PK만 남아 판별이 불가능) — 다른 트립의 delete 이벤트일 수 있으므로
          // 동기화 시각을 갱신하지 않는다. 화면 refresh 자체는 RLS로 걸러진
          // 재조회라 안전하다.
          if (payload.eventType !== 'DELETE') {
            setLastSyncedAt(new Date())
          }

          if (payload.eventType === 'UPDATE') {
            const record = payload.new as { id?: number; updated_by?: string | null }
            if (
              record.id != null &&
              shouldNotifyOverwrite({
                edits: editsRef.current,
                table,
                recordId: record.id,
                editorId: record.updated_by ?? null,
                myUserId: userId,
                now: Date.now(),
              })
            ) {
              const editorEmail = record.updated_by
                ? membersRef.current[record.updated_by]
                : undefined
              toast(`${editorEmail ?? '다른 멤버'}님이 방금 이 항목을 수정했어요`)
            }
          }

          // 이벤트가 몰릴 때 refresh 폭주를 막는 디바운스. 서버 컴포넌트 재조회로
          // 화면을 갱신하므로 레코드 단위 병합이 필요 없다 (LWW: DB 상태가 곧 최종).
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
          refreshTimerRef.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS)
        }
      )
    }

    channel.on('presence', { event: 'sync' }, () => {
      // presence는 userId(불투명 UUID)로 keyed되어 있으므로 표시용 이메일은
      // 로컬에서 멤버 맵을 통해 조회한다 — 이메일이 프레즌스 페이로드에 실려
      // 와이어를 타지 않는다.
      const ids = Object.keys(channel.presenceState())
      setOnlineEmails(ids.map((id) => membersRef.current[id] ?? '?'))
    })

    let disposed = false
    ;(async () => {
      // private 채널은 join 전에 realtime 소켓이 현재 세션의 JWT를 알아야
      // realtime.messages RLS(트립 멤버 여부)를 통과한다.
      await supabase.realtime.setAuth()
      if (disposed) return
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setLastSyncedAt(new Date())
          await channel.track({ online_at: new Date().toISOString() })
        }
      })
    })()

    return () => {
      disposed = true
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      supabase.removeChannel(channel)
    }
  }, [tripId, userId, userEmail, router])

  return (
    <TripRealtimeContext.Provider value={{ lastSyncedAt, onlineEmails, markEdited }}>
      {children}
    </TripRealtimeContext.Provider>
  )
}

export function PresenceAvatars() {
  const { onlineEmails } = useTripRealtime()
  if (onlineEmails.length === 0) return null

  return (
    <div className="flex -space-x-2" aria-label="현재 접속 중인 멤버">
      {onlineEmails.map((email) => (
        <span
          key={email}
          title={email}
          className="flex size-7 items-center justify-center rounded-full border bg-secondary text-xs font-medium"
        >
          {email[0]?.toUpperCase() ?? '?'}
        </span>
      ))}
    </div>
  )
}
