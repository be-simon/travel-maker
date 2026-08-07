import { describe, expect, it } from 'vitest'
import { parseGmapUrl, unwrapConsentUrl } from './gmap-url'

describe('unwrapConsentUrl', () => {
  it('extracts the continue param from google consent pages', () => {
    const target = 'https://www.google.com/maps/place/Duomo/@45.4,9.1,17z'
    const wrapped = `https://consent.google.com/m?continue=${encodeURIComponent(target)}&gl=DE`
    expect(unwrapConsentUrl(wrapped)).toBe(target)
  })

  it('returns other urls unchanged (including invalid ones)', () => {
    expect(unwrapConsentUrl('https://www.google.com/maps')).toBe('https://www.google.com/maps')
    expect(unwrapConsentUrl('not a url')).toBe('not a url')
  })
})

describe('parseGmapUrl', () => {
  it('parses a full place url: name, precise !3d!4d coords over @viewport', () => {
    const url =
      'https://www.google.com/maps/place/Duomo+di+Milano/@45.4641013,9.1877756,17z/data=!3m1!4b1!4m6!3m5!1s0x4786c40cd3ce0d1d:0x373466f42f4e0da3!8m2!3d45.4641013!4d9.1899643!16zL20vMDE1cXFr'
    expect(parseGmapUrl(url)).toEqual({
      name: 'Duomo di Milano',
      lat: 45.4641013,
      lng: 9.1899643,
      placeId: null,
    })
  })

  it('decodes unicode place names', () => {
    const url = 'https://www.google.com/maps/place/%EA%B2%BD%EB%B3%B5%EA%B6%81/@37.579617,126.977041,17z'
    const parsed = parseGmapUrl(url)
    expect(parsed?.name).toBe('경복궁')
    expect(parsed?.lat).toBeCloseTo(37.579617)
    expect(parsed?.lng).toBeCloseTo(126.977041)
  })

  it('reads query_place_id from maps search api links', () => {
    const url =
      'https://www.google.com/maps/search/?api=1&query=45.4641%2C9.1899&query_place_id=ChIJb_bcKa7BhkcRont5Ny6rC0w'
    expect(parseGmapUrl(url)).toEqual({
      name: null,
      lat: 45.4641,
      lng: 9.1899,
      placeId: 'ChIJb_bcKa7BhkcRont5Ny6rC0w',
    })
  })

  it('finds a ChIJ token embedded in the data param', () => {
    const url =
      'https://www.google.com/maps/place/Duomo/@45.4,9.1,17z/data=!4m6!3m5!1sChIJb_bcKa7BhkcRont5Ny6rC0w!8m2!3d45.4641!4d9.1899'
    expect(parseGmapUrl(url)?.placeId).toBe('ChIJb_bcKa7BhkcRont5Ny6rC0w')
  })

  it('treats a non-coordinate q param as a name', () => {
    expect(parseGmapUrl('https://maps.google.com/?q=Duomo+di+Milano')).toEqual({
      name: 'Duomo di Milano',
      lat: null,
      lng: null,
      placeId: null,
    })
  })

  it('treats a coordinate q param as coords', () => {
    expect(parseGmapUrl('https://maps.google.com/?q=45.4641,9.1899')).toEqual({
      name: null,
      lat: 45.4641,
      lng: 9.1899,
      placeId: null,
    })
  })

  it('parses through a consent wrapper', () => {
    const target = 'https://www.google.com/maps/place/Duomo/@45.4,9.1,17z'
    const wrapped = `https://consent.google.com/m?continue=${encodeURIComponent(target)}`
    expect(parseGmapUrl(wrapped)?.name).toBe('Duomo')
  })

  it('returns null when nothing is extractable', () => {
    expect(parseGmapUrl('https://www.google.com/maps')).toBeNull()
    expect(parseGmapUrl('not a url')).toBeNull()
  })

  it('does not double-decode q param names', () => {
    expect(parseGmapUrl('https://maps.google.com/?q=100%25%20Coffee')?.name).toBe('100% Coffee')
    expect(parseGmapUrl('https://maps.google.com/?q=Fish%2BChips')?.name).toBe('Fish+Chips')
  })
})
