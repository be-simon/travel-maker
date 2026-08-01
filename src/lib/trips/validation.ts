export function validateTripDates(startDate: string, endDate: string): string | null {
  if (!startDate || !endDate) return '시작일과 종료일을 입력해 주세요.'
  if (endDate < startDate) return '종료일은 시작일보다 빠를 수 없습니다.'
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateInviteEmail(email: string): string | null {
  if (!EMAIL_RE.test(email)) return '올바른 이메일 형식이 아닙니다.'
  return null
}
