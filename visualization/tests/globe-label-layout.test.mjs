import assert from 'node:assert/strict'
import { test } from 'node:test'
import { placeGlobeLabel } from '../src/globe-label-layout.ts'

test('stacks site labels when zoom pushes them into the same corner', () => {
  const viewport = { width: 260, height: 310 }
  const size = { width: 164, height: 52 }
  const first = placeGlobeLabel({ x: -40, y: 325 }, size, viewport, [])
  const second = placeGlobeLabel({ x: 35, y: 340 }, size, viewport, [first])
  const third = placeGlobeLabel({ x: 125, y: 330 }, size, viewport, [first, second])

  assert.deepEqual([first.y, second.y, third.y], [250, 190, 130])
  assert.equal(first.x, 8)
  assert.equal(third.x + third.width, viewport.width - 8)
})
