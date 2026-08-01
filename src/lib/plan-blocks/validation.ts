export function validateBlockTitle(title: string): string | null {
  if (!title.trim()) return '제목을 입력해 주세요.'
  return null
}

export function validateBlockTimes(startTime: string, endTime: string): string | null {
  if (!startTime || !endTime) return '시작 시간과 종료 시간을 입력해 주세요.'
  if (endTime <= startTime) return '종료 시간은 시작 시간보다 늦어야 합니다.'
  return null
}
