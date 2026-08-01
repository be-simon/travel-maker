// src/lib/spots/validation.test.ts
import { describe, it, expect } from 'vitest'
import { validateSpotName } from './validation'

describe('validateSpotName', () => {
  it('rejects an empty name', () => {
    expect(validateSpotName('')).toBe('장소 이름을 입력해 주세요.')
  })

  it('rejects a whitespace-only name', () => {
    expect(validateSpotName('   ')).toBe('장소 이름을 입력해 주세요.')
  })

  it('accepts a valid name', () => {
    expect(validateSpotName('두오모')).toBeNull()
  })
})
