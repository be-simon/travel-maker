// Places API(New)의 addressComponents에서 국가/도시를 추출한다. PRD는 "좌표 기반
// 역지오코딩"을 명시했지만, Place Details 응답에 이미 포함된 컴포넌트를 쓰면 추가
// API 호출 없이 같은 결과를 얻는다 (spec §3).
export interface AddressComponentLike {
  longText: string | null
  types: string[]
}

export function extractCountryCity(
  components: AddressComponentLike[] | null | undefined
): { country: string | null; city: string | null } {
  if (!components) return { country: null, city: null }
  const find = (type: string) =>
    components.find((component) => component.types.includes(type))?.longText ?? null
  return {
    country: find('country'),
    city: find('locality') ?? find('administrative_area_level_1'),
  }
}
