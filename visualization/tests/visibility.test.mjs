import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { compare, gridDirection } from '../src/model.ts'

const data = site => JSON.parse(readFileSync(new URL(`../public/data/${site}/visibility.json`, import.meta.url)))

test('R01: Земля выше 0°, но скрыта рельефом', () => {
  const site = data('R01')
  const i = site.times.indexOf('2026-11-17 23:00')
  assert.ok(i >= 0)
  const result = compare(site.Earth[i])
  assert.equal(result.flat, true)
  assert.equal(result.local, false)
  assert.ok(Math.abs(result.margin - (-1.25745)) < 1e-6)
})

test('R11: местный горизонт меняет ответ в обратную сторону', () => {
  const sample = data('R11').Earth.find(([, elevation, horizon]) => elevation < 0 && horizon < elevation)
  assert.ok(sample)
  const result = compare(sample)
  assert.equal(result.flat, false)
  assert.equal(result.local, true)
})

test('Южная стереографическая проекция поворачивает истинный север', () => {
  const [x, y] = gridDirection(-90, 0)
  assert.ok(Math.abs(x+1) < 1e-12)
  assert.ok(Math.abs(y) < 1e-12)
})
