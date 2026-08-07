// 구글맵 공유 링크(Edge Function이 리다이렉트를 푼 최종 URL)에서 장소 후보
// 정보를 추출한다. 여기서 나온 값은 후보일 뿐이고, 확정은 Places API 조회
// (link-import-dialog)가 한다 — PRD F3: 자동 신뢰하지 않음.

export interface ParsedGmapPlace {
  name: string | null
  lat: number | null
  lng: number | null
  placeId: string | null
}

// EU 등에서 구글이 consent.google.com/m?continue=<원본> 으로 감싸는 경우 원본을 꺼낸다.
export function unwrapConsentUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    if (url.hostname === 'consent.google.com') {
      const continueUrl = url.searchParams.get('continue')
      if (continueUrl) return continueUrl
    }
    return rawUrl
  } catch {
    return rawUrl
  }
}

const PLACE_ID_RE = /ChIJ[0-9A-Za-z_-]{10,}\b/

function decodeName(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment.replace(/\+/g, ' ')).trim()
    return decoded || null
  } catch {
    return null
  }
}

export function parseGmapUrl(rawUrl: string): ParsedGmapPlace | null {
  let url: URL
  try {
    url = new URL(unwrapConsentUrl(rawUrl))
  } catch {
    return null
  }

  let name: string | null = null
  let lat: number | null = null
  let lng: number | null = null

  // 1) 명시적 place_id 파라미터, 2) URL 어디든 박힌 ChIJ 토큰(!1sChIJ... 등)
  let placeId = url.searchParams.get('query_place_id') ?? url.searchParams.get('place_id')
  if (!placeId) {
    try {
      placeId = decodeURIComponent(url.href).match(PLACE_ID_RE)?.[0] ?? null
    } catch {
      placeId = url.href.match(PLACE_ID_RE)?.[0] ?? null
    }
  }

  const placeMatch = url.pathname.match(/\/maps\/place\/([^/]+)/)
  if (placeMatch) name = decodeName(placeMatch[1])

  // data 파라미터의 !3d..!4d..가 장소 좌표(@는 뷰포트 중심이라 부정확할 수 있음).
  const dataMatch = url.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
  if (dataMatch) {
    lat = parseFloat(dataMatch[1])
    lng = parseFloat(dataMatch[2])
  } else {
    const atMatch = url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
    if (atMatch) {
      lat = parseFloat(atMatch[1])
      lng = parseFloat(atMatch[2])
    }
  }

  const q = url.searchParams.get('q') ?? url.searchParams.get('query')
  if (q) {
    const coordMatch = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (coordMatch) {
      if (lat === null) {
        lat = parseFloat(coordMatch[1])
        lng = parseFloat(coordMatch[2])
      }
    } else if (!name) {
      name = decodeName(q)
    }
  }

  if (name === null && lat === null && placeId === null) return null
  return { name, lat, lng, placeId }
}
