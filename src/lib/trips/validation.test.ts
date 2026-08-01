import { describe, it, expect } from 'vitest'
import { validateTripDates, validateInviteEmail } from './validation'

describe('validateTripDates', () => {
  it('rejects an end date before the start date', () => {
    expect(validateTripDates('2026-05-20', '2026-05-11')).toBe(
      '종료일은 시작일보다 빠를 수 없습니다.'
    )
  })

  it('rejects missing dates', () => {
    expect(validateTripDates('', '2026-05-11')).toBe('시작일과 종료일을 입력해 주세요.')
  })

  it('accepts a valid range', () => {
    expect(validateTripDates('2026-05-11', '2026-05-23')).toBeNull()
  })

  it('accepts a single-day trip', () => {
    expect(validateTripDates('2026-05-11', '2026-05-11')).toBeNull()
  })
})

describe('validateInviteEmail', () => {
  it('rejects an obviously invalid email', () => {
    expect(validateInviteEmail('not-an-email')).toBe('올바른 이메일 형식이 아닙니다.')
  })

  it('accepts a valid email', () => {
    expect(validateInviteEmail('friend@example.com')).toBeNull()
  })
})
