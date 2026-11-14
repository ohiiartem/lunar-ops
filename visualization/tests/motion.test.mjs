import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dampingAt } from '../src/motion.ts'

test('60, 120 и 144 Гц дают одинаковое затухание за секунду', () => {
  for (const hz of [60,120,144]) {
    let remaining = 1
    for (let frame=0;frame<hz;frame++) remaining *= 1-dampingAt(1/hz)
    assert.ok(Math.abs(remaining-Math.exp(-9)) < 1e-12)
  }
})
