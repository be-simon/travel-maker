// 구글맵 공유 링크(단축링크 포함)의 리다이렉트 체인을 서버에서 해석한다.
// 클라이언트가 직접 못 하는 이유: 단축 도메인이 CORS를 허용하지 않고, fetch가
// 최종 URL을 노출하지 않기 때문 (PRD §6). 파싱·Places 확정은 클라이언트 몫.
import { MAX_REDIRECTS, isAllowedGmapHost, validateStartUrl } from './logic.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST만 지원합니다.' }, 405)

  let body: { url?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: '요청 본문이 올바르지 않습니다.' }, 400)
  }
  if (typeof body.url !== 'string') return json({ error: 'url이 필요합니다.' }, 400)

  const validated = validateStartUrl(body.url)
  if (!validated.ok) return json({ error: validated.error }, 400)

  let current = validated.url
  try {
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const res = await fetch(current, { method: 'GET', redirect: 'manual' })
      // 본문은 쓰지 않는다 — 커넥션 정리를 위해 취소.
      await res.body?.cancel()
      if (res.status < 300 || res.status >= 400) break
      const location = res.headers.get('location')
      if (!location) break
      const next = new URL(location, current)
      if (next.protocol !== 'https:' || !isAllowedGmapHost(next.hostname)) {
        return json({ error: '허용되지 않은 리다이렉트 대상입니다.' }, 400)
      }
      current = next.href
    }
  } catch (error) {
    console.error('resolve-gmap-link fetch failed:', error)
    return json({ error: '링크를 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 502)
  }

  return json({ finalUrl: current }, 200)
})
