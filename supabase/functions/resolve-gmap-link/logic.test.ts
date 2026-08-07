import { describe, expect, it } from 'vitest'
import { MAX_REDIRECTS, isAllowedGmapHost, validateStartUrl } from './logic'

describe('isAllowedGmapHost', () => {
  it('allows google shortener and maps hosts', () => {
    for (const host of [
      'maps.app.goo.gl',
      'goo.gl',
      'g.co',
      'google.com',
      'www.google.com',
      'maps.google.com',
      'google.de',
      'google.co.kr',
      'www.google.co.uk',
      'consent.google.com',
    ]) {
      expect(isAllowedGmapHost(host), host).toBe(true)
    }
  })

  it('rejects everything else, including lookalikes', () => {
    for (const host of [
      'evil.com',
      'xgoogle.com',
      'google.evil.com',
      'notgoo.gl',
      'goo.gl.evil.com',
      'localhost',
      '169.254.169.254',
    ]) {
      expect(isAllowedGmapHost(host), host).toBe(false)
    }
  })
})

describe('validateStartUrl', () => {
  it('accepts https google links (trimmed)', () => {
    expect(validateStartUrl('  https://maps.app.goo.gl/AbCdEf  ')).toEqual({
      ok: true,
      url: 'https://maps.app.goo.gl/AbCdEf',
    })
  })

  it('rejects non-https, non-google, and malformed urls', () => {
    expect(validateStartUrl('http://maps.app.goo.gl/AbCdEf').ok).toBe(false)
    expect(validateStartUrl('https://evil.com/maps').ok).toBe(false)
    expect(validateStartUrl('not a url').ok).toBe(false)
  })
})

it('caps redirects at 5', () => {
  expect(MAX_REDIRECTS).toBe(5)
})
