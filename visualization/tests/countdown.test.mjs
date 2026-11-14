import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describe, formatDuration, formatWindow, nextChange } from '../src/countdown.ts'

const labels = { ending: 'Sunset', starting: 'Sunrise', stays: 'Up', stayed: 'Down' }
test('Counts steps to the next change from the observation time', () => {
  const flags = [true, true, true, false, false, true]
  assert.deepEqual(nextChange(flags, 0), { visible: true, steps: 3, atIndex: 3 })
  assert.deepEqual(nextChange(flags, 3), { visible: false, steps: 2, atIndex: 5 })
  assert.equal(nextChange(flags, 5).steps, null)
})

test('Text uses the step length and contains no date', () => {
  const flags = [true, true, true, false, false, true]
  assert.deepEqual(describe(flags, 1, 30, labels), { label: 'Sunset in', time: '1 h' })
  assert.deepEqual(describe(flags, 5, 30, labels), { label: 'Up until the end of the period', time: '0 min left' })
})

test('Durations', () => {
  assert.equal(formatDuration(0.5), '30 min')
  assert.equal(formatDuration(2), '2 h')
  assert.equal(formatDuration(2.5), '2 h 30 min')
  assert.equal(formatDuration(53), '2 d 5 h')
})

test('Countdowns show changes at each half-hour step even days before an event', () => {
  const flags = [...Array(101).fill(true), false]
  assert.equal(describe(flags, 0, 30, labels).time, '2 d 2 h 30 min')
  assert.equal(describe(flags, 1, 30, labels).time, '2 d 2 h')
  assert.equal(describe(flags, 2, 30, labels).time, '2 d 1 h 30 min')
})

test('Windows are short and show the duration', () => {
  assert.equal(formatWindow('2026-11-28T12:40:00Z','2026-11-28T23:50:00Z'), '28 Nov 12:40 → 23:50 · 11 h 10 min')
  assert.equal(formatWindow('2026-11-14T00:00:00Z','2026-11-25T21:30:00Z'), '14 Nov 00:00 → 25 Nov 21:30 · 11 d 21 h')
})
