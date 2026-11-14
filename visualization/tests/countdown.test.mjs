import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describe, formatDuration, nextChange } from '../src/countdown.ts'

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
