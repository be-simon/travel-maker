import { describe, expect, it } from 'vitest'
import {
  DAY_MINUTES,
  MIN_BLOCK_MINUTES,
  dragCreateRange,
  moveRange,
  pxToMinutes,
  resizeRange,
  snapMinutes,
} from './grid'

// 그리드는 30분 슬롯 × 28px → 1분당 28/30px
const PPM = 28 / 30

describe('snapMinutes / pxToMinutes', () => {
  it('snaps to 15-minute steps', () => {
    expect(snapMinutes(0)).toBe(0)
    expect(snapMinutes(7)).toBe(0)
    expect(snapMinutes(8)).toBe(15)
    expect(snapMinutes(22)).toBe(15)
    expect(snapMinutes(23)).toBe(30)
  })

  it('converts px to snapped minutes clamped to the day', () => {
    expect(pxToMinutes(0, PPM)).toBe(0)
    expect(pxToMinutes(28, PPM)).toBe(30)
    expect(pxToMinutes(14, PPM)).toBe(15)
    expect(pxToMinutes(-10, PPM)).toBe(0)
    expect(pxToMinutes(100_000, PPM)).toBe(DAY_MINUTES)
  })
})

describe('dragCreateRange', () => {
  it('orders anchor/current and snaps both ends', () => {
    // 9:00(504px) → 10:30(984px≈)
    expect(dragCreateRange(9 * 60 * PPM, 10.5 * 60 * PPM, PPM)).toEqual({
      startMin: 540,
      endMin: 630,
    })
    // 아래에서 위로 드래그해도 동일
    expect(dragCreateRange(10.5 * 60 * PPM, 9 * 60 * PPM, PPM)).toEqual({
      startMin: 540,
      endMin: 630,
    })
  })

  it('enforces the minimum block length', () => {
    const px = 9 * 60 * PPM
    expect(dragCreateRange(px, px + 2, PPM)).toEqual({
      startMin: 540,
      endMin: 540 + MIN_BLOCK_MINUTES,
    })
  })

  it('keeps the range inside the day at the bottom edge', () => {
    const bottom = DAY_MINUTES * PPM
    const range = dragCreateRange(bottom, bottom, PPM)
    expect(range.endMin).toBe(DAY_MINUTES)
    expect(range.startMin).toBe(DAY_MINUTES - MIN_BLOCK_MINUTES)
  })
})

describe('moveRange', () => {
  it('shifts preserving duration with snapping', () => {
    // 9:00–10:00을 +20분어치 px만큼: snap(560) = round(560/15)*15 = 555
    expect(moveRange(540, 600, 20 * PPM, PPM)).toEqual({ startMin: 555, endMin: 615 })
    expect(moveRange(540, 600, -20 * PPM, PPM)).toEqual({ startMin: 525, endMin: 585 })
  })

  it('clamps to day bounds preserving duration', () => {
    expect(moveRange(0, 60, -100 * PPM, PPM)).toEqual({ startMin: 0, endMin: 60 })
    expect(moveRange(DAY_MINUTES - 60, DAY_MINUTES, 100 * PPM, PPM)).toEqual({
      startMin: DAY_MINUTES - 60,
      endMin: DAY_MINUTES,
    })
  })
})

describe('resizeRange', () => {
  it('resizes the chosen edge with snapping', () => {
    expect(resizeRange(540, 600, 'bottom', 30 * PPM, PPM)).toEqual({ startMin: 540, endMin: 630 })
    expect(resizeRange(540, 600, 'top', -30 * PPM, PPM)).toEqual({ startMin: 510, endMin: 600 })
  })

  it('never shrinks below the minimum length', () => {
    expect(resizeRange(540, 600, 'bottom', -300 * PPM, PPM)).toEqual({
      startMin: 540,
      endMin: 540 + MIN_BLOCK_MINUTES,
    })
    expect(resizeRange(540, 600, 'top', 300 * PPM, PPM)).toEqual({
      startMin: 600 - MIN_BLOCK_MINUTES,
      endMin: 600,
    })
  })

  it('clamps to day bounds', () => {
    expect(resizeRange(540, 600, 'bottom', 10_000, PPM).endMin).toBe(DAY_MINUTES)
    expect(resizeRange(540, 600, 'top', -10_000, PPM).startMin).toBe(0)
  })
})
