export function validateBlockTitle(title: string): string | null {
  if (!title.trim()) return '제목을 입력해 주세요.'
  return null
}

export function validateBlockTimes(startTime: string, endTime: string): string | null {
  if (!startTime || !endTime) return '시작 시간과 종료 시간을 입력해 주세요.'
  if (endTime <= startTime) return '종료 시간은 시작 시간보다 늦어야 합니다.'
  return null
}

// 블록 날짜가 여행 기간(start_date~end_date) 밖으로 나가면 해당 날짜에는
// 타임라인 컬럼 자체가 없어(enumerateDates 참고) 블록이 화면에서 통째로
// 사라지고 되찾을 방법이 없다 — 날짜 문자열이 'YYYY-MM-DD' 형식이므로
// 문자열 비교만으로 범위 검사가 가능하다.
export function validateBlockDate(
  date: string,
  tripStartDate: string,
  tripEndDate: string
): string | null {
  if (date < tripStartDate || date > tripEndDate) return '날짜는 여행 기간 안에서 선택해 주세요.'
  return null
}
