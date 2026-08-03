import { describe, it, expect } from 'vitest'
import { extractCountryCity } from './address'

describe('extractCountryCity', () => {
  it('extracts country and locality', () => {
    expect(
      extractCountryCity([
        { longText: 'Milano', types: ['locality', 'political'] },
        { longText: 'Lombardia', types: ['administrative_area_level_1', 'political'] },
        { longText: 'Italia', types: ['country', 'political'] },
      ])
    ).toEqual({ country: 'Italia', city: 'Milano' })
  })

  it('falls back to administrative_area_level_1 when locality is missing', () => {
    expect(
      extractCountryCity([
        { longText: 'Tuscany', types: ['administrative_area_level_1'] },
        { longText: 'Italy', types: ['country'] },
      ])
    ).toEqual({ country: 'Italy', city: 'Tuscany' })
  })

  it('returns nulls for empty or missing components', () => {
    expect(extractCountryCity([])).toEqual({ country: null, city: null })
    expect(extractCountryCity(null)).toEqual({ country: null, city: null })
    expect(extractCountryCity(undefined)).toEqual({ country: null, city: null })
  })
})
