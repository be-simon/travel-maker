import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enumerateDates } from './timeline-view'

// enumerateDates는 날짜 문자열을 반드시 UTC로 파싱/증가시켜야 한다. UTC+ 타임존
// (한국 등)에서 로컬 자정으로 파싱한 뒤 toISOString()(UTC)으로 읽으면 모든 날짜가
// 하루씩 앞으로 밀리고, 트립의 마지막 날짜 컬럼이 통째로 사라진다 — 이 버그는
// 테스트 실행 환경의 타임존에 따라 나타나거나 나타나지 않으므로, 실제로 버그를
// 재현했던 'Asia/Seoul'(UTC+9)을 포함해 여러 타임존에서 명시적으로 고정하고
// 검증한다.
describe.each(['Asia/Seoul', 'UTC', 'America/New_York'])('enumerateDates (TZ=%s)', (tz) => {
  let originalTz: string | undefined

  beforeEach(() => {
    originalTz = process.env.TZ
    process.env.TZ = tz
  })

  afterEach(() => {
    process.env.TZ = originalTz
  })

  it('enumerates an inclusive multi-day range', () => {
    expect(enumerateDates('2026-06-01', '2026-06-03')).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
    ])
  })

  it('returns exactly one date for a single-day trip', () => {
    expect(enumerateDates('2026-05-11', '2026-05-11')).toEqual(['2026-05-11'])
  })

  it('crosses a year boundary correctly', () => {
    expect(enumerateDates('2026-12-30', '2027-01-01')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ])
  })
})
