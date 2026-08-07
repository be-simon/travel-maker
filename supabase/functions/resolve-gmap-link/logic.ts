// resolve-gmap-link의 순수 로직. Deno API를 쓰지 않아 vitest(Node)로 테스트한다.
// SSRF 방지가 목적: 사용자가 넘긴 URL과 그 리다이렉트 체인이 전부 이 화이트리스트
// 안에 있어야만 fetch한다.

export const MAX_REDIRECTS = 5

const SHORTENER_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'www.goo.gl', 'g.co'])

// google.com과 그 서브도메인만 허용. 구글이 국가별 도메인을 google.com으로 통합했으므로
// SSRF 표면을 최소화하려 google.com 계열만 인정한다.
const GOOGLE_HOST_RE = /^([a-z0-9-]+\.)*google\.com$/

export function isAllowedGmapHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return SHORTENER_HOSTS.has(host) || GOOGLE_HOST_RE.test(host)
}

export function validateStartUrl(
  raw: string
): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, error: '올바른 URL이 아닙니다.' }
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'https 링크만 지원합니다.' }
  if (!isAllowedGmapHost(url.hostname)) {
    return { ok: false, error: 'Google 지도 링크만 지원합니다.' }
  }
  return { ok: true, url: url.href }
}
