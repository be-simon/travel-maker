import { describe, expect, it } from 'vitest'
import {
  RECENT_EDIT_WINDOW_MS,
  makeKey,
  pruneEdits,
  shouldNotifyOverwrite,
} from './overwrite'

const ME = 'user-me'
const OTHER = 'user-other'

function editsWith(table: string, id: number, at: number) {
  return new Map([[makeKey(table, id), at]])
}

describe('shouldNotifyOverwrite', () => {
  it('notifies when another member updates a record I edited within the window', () => {
    expect(
      shouldNotifyOverwrite({
        edits: editsWith('plan_blocks', 1, 1_000),
        table: 'plan_blocks',
        recordId: 1,
        editorId: OTHER,
        myUserId: ME,
        now: 1_000 + RECENT_EDIT_WINDOW_MS,
      })
    ).toBe(true)
  })

  it('ignores my own write echo', () => {
    expect(
      shouldNotifyOverwrite({
        edits: editsWith('plan_blocks', 1, 1_000),
        table: 'plan_blocks',
        recordId: 1,
        editorId: ME,
        myUserId: ME,
        now: 2_000,
      })
    ).toBe(false)
  })

  it('ignores records I did not recently edit', () => {
    expect(
      shouldNotifyOverwrite({
        edits: editsWith('plan_blocks', 1, 1_000),
        table: 'plan_blocks',
        recordId: 2,
        editorId: OTHER,
        myUserId: ME,
        now: 2_000,
      })
    ).toBe(false)
    expect(
      shouldNotifyOverwrite({
        edits: editsWith('spots', 1, 1_000),
        table: 'plan_blocks',
        recordId: 1,
        editorId: OTHER,
        myUserId: ME,
        now: 2_000,
      })
    ).toBe(false)
  })

  it('ignores edits older than the window and unknown editors', () => {
    expect(
      shouldNotifyOverwrite({
        edits: editsWith('plan_blocks', 1, 1_000),
        table: 'plan_blocks',
        recordId: 1,
        editorId: OTHER,
        myUserId: ME,
        now: 1_001 + RECENT_EDIT_WINDOW_MS,
      })
    ).toBe(false)
    expect(
      shouldNotifyOverwrite({
        edits: editsWith('plan_blocks', 1, 1_000),
        table: 'plan_blocks',
        recordId: 1,
        editorId: null,
        myUserId: ME,
        now: 2_000,
      })
    ).toBe(false)
  })
})

describe('pruneEdits', () => {
  it('drops entries older than the window, keeps fresh ones', () => {
    const edits = new Map([
      [makeKey('plan_blocks', 1), 0],
      [makeKey('plan_blocks', 2), 50_000],
    ])
    pruneEdits(edits, 70_000)
    expect(edits.has(makeKey('plan_blocks', 1))).toBe(false)
    expect(edits.has(makeKey('plan_blocks', 2))).toBe(true)
  })
})
