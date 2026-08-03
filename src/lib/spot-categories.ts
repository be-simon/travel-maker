import type { SpotCategory } from '@/types/database'

export const CATEGORY_OPTIONS: { value: SpotCategory; label: string }[] = [
  { value: 'sight', label: '관광' },
  { value: 'restaurant', label: '식당' },
  { value: 'cafe', label: '카페' },
  { value: 'shopping', label: '쇼핑' },
  { value: 'lodging', label: '숙소' },
  { value: 'etc', label: '기타' },
]

export const CATEGORY_LABELS: Record<SpotCategory, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((option) => [option.value, option.label])
) as Record<SpotCategory, string>
