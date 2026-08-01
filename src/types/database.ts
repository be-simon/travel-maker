export type TripRole = 'owner' | 'editor'
export type TripMemberStatus = 'pending' | 'active'
export type SpotCategory = 'sight' | 'restaurant' | 'cafe' | 'shopping' | 'lodging' | 'etc'
export type SpotStatus = 'candidate' | 'planned' | 'visited'
export type BookmarkSource = 'manual' | 'gmap_link' | 'ocr'
export type BlockType = 'spot' | 'transport' | 'lodging' | 'memo'

export interface Trip {
  id: number
  title: string
  start_date: string
  end_date: string
  owner_id: string
  created_at: string
  updated_at: string
}

export interface TripMember {
  id: number
  trip_id: number
  user_id: string | null
  invited_email: string
  role: TripRole
  status: TripMemberStatus
  created_at: string
}

export interface Bookmark {
  id: number
  owner_id: string
  name: string
  category: SpotCategory
  country: string | null
  city: string | null
  place_id: string | null
  lat: number | null
  lng: number | null
  address: string | null
  memo: string | null
  source: BookmarkSource
  created_at: string
}

export interface SpotGroup {
  id: number
  trip_id: number
  name: string
  sort_order: number
}

export interface Spot {
  id: number
  trip_id: number
  group_id: number | null
  bookmark_id: number | null
  name: string
  category: SpotCategory
  place_id: string | null
  lat: number | null
  lng: number | null
  address: string | null
  memo: string | null
  priority: boolean
  est_cost: number | null
  link: string | null
  status: SpotStatus
  created_at: string
  updated_at: string
}

export interface PlanBlock {
  id: number
  trip_id: number
  date: string
  start_time: string
  end_time: string
  type: BlockType
  spot_id: number | null
  title: string
  memo: string | null
  created_at: string
  updated_at: string
}
