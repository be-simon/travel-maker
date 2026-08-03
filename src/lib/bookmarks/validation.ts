export function validateBookmarkName(name: string): string | null {
  if (!name.trim()) return '장소 이름을 입력해 주세요.'
  return null
}
