import { describe, it, expect } from 'vitest'
import { validateBookmarkName } from './validation'

describe('validateBookmarkName', () => {
  it('rejects empty and whitespace-only names', () => {
    expect(validateBookmarkName('')).not.toBeNull()
    expect(validateBookmarkName('   ')).not.toBeNull()
  })

  it('accepts a normal name', () => {
    expect(validateBookmarkName('두오모')).toBeNull()
  })
})
