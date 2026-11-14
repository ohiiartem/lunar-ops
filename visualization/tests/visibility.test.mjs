import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { compare, directionAt, gridDirection, lunarDirection } from '../src/model.ts'

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

test('Направление света совпадает в обеих площадках и меняется по времени', () => {
  const sunlight = (site, index) => {
    const read = file => JSON.parse(readFileSync(new URL(`../public/data/${site}/${file}.json`, import.meta.url)))
    const data = read('sky')
    const observations = { Sun: data.sun_az.map((azimuth, i) => [azimuth, data.sun_alt[i]]) }
    const [lon, lat] = read('metadata').longitude_latitude_deg
    return lunarDirection(lon, lat, ...directionAt(observations, 'Sun', index))
  }
  const [day, night] = [1000, 280].map(index => sunlight('R01', index))
  assert.ok(Math.abs(Math.hypot(...day) - 1) < 1e-12)
  const visibleSide = lunarDirection(-47, -48, 0, 90)
  const facing = direction => direction.reduce((dot, axis, i) => dot + axis * visibleSide[i], 0)
  assert.ok(facing(day) > 0.6)
  assert.ok(facing(night) < -0.6)
  const sameTime = sunlight('R11', 1000)
  assert.ok(Math.hypot(...day.map((axis, i) => axis - sameTime[i])) < 0.0001)
})
