import { describe, it, expect } from 'vitest'
import { validateBlockTitle, validateBlockTimes, validateBlockDate } from './validation'

describe('validateBlockTitle', () => {
  it('rejects an empty title', () => {
    expect(validateBlockTitle('')).toBe('제목을 입력해 주세요.')
  })

  it('accepts a valid title', () => {
    expect(validateBlockTitle('두오모 투어')).toBeNull()
  })
})

describe('validateBlockTimes', () => {
  it('rejects missing times', () => {
    expect(validateBlockTimes('', '10:00:00')).toBe('시작 시간과 종료 시간을 입력해 주세요.')
  })

  it('rejects an end time not after the start time', () => {
    expect(validateBlockTimes('10:00:00', '10:00:00')).toBe('종료 시간은 시작 시간보다 늦어야 합니다.')
    expect(validateBlockTimes('10:30:00', '10:00:00')).toBe('종료 시간은 시작 시간보다 늦어야 합니다.')
  })

  it('accepts a valid range', () => {
    expect(validateBlockTimes('09:00:00', '10:30:00')).toBeNull()
  })
})

describe('validateBlockDate', () => {
  it('accepts a date within the trip range', () => {
    expect(validateBlockDate('2026-06-02', '2026-06-01', '2026-06-05')).toBeNull()
  })

  it('rejects a date before the trip start date', () => {
    expect(validateBlockDate('2026-05-31', '2026-06-01', '2026-06-05')).toBe(
      '날짜는 여행 기간 안에서 선택해 주세요.'
    )
  })

  it('rejects a date after the trip end date', () => {
    expect(validateBlockDate('2026-06-06', '2026-06-01', '2026-06-05')).toBe(
      '날짜는 여행 기간 안에서 선택해 주세요.'
    )
  })

  it('accepts the trip start and end dates as boundaries', () => {
    expect(validateBlockDate('2026-06-01', '2026-06-01', '2026-06-05')).toBeNull()
    expect(validateBlockDate('2026-06-05', '2026-06-01', '2026-06-05')).toBeNull()
  })
})
