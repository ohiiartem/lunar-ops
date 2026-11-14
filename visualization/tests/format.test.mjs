import assert from 'node:assert/strict'
import { test } from 'node:test'
import { num } from '../src/format.ts'

test('Whole numbers stay whole, others get one decimal', () => {
  assert.equal(num(620), '620')
  assert.equal(num(254.5), '254.5')
  assert.equal(num(136.232794), '136.2')
  assert.equal(num(2.96), '3')
  assert.equal(num(-0.04), '0')
  assert.equal(num(-4.549), '-4.5')
  assert.equal(num(63.5), '63.5')
})
