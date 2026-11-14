import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { directionAt, explainVisibility, gridDirection, lunarDirection } from '../src/model.ts'

const read = path => JSON.parse(readFileSync(new URL('../public/data/'+path, import.meta.url)))

test('Offline catalogue and API snapshots agree on site, period, source and step', () => {
  const {sites} = read('sites.json')
  assert.ok(sites.length>0)
  for (const site of sites) {
    const {scenario,timeseries,analysis} = read(site.id.replace(/^Site/,'R')+'/sky.json')
    assert.equal(scenario.site_id,site.id)
    assert.equal(timeseries.site_id,site.id)
    assert.equal(timeseries.data_source,'jpl_horizons')
    assert.equal(analysis.data_source,'jpl_horizons')
    assert.equal(timeseries.t[0],scenario.start)
    assert.equal(timeseries.t.length,scenario.days*1440/scenario.step_min)
    assert.ok(timeseries.t.every((time,i)=>Date.parse(time)===Date.parse(scenario.start)+i*scenario.step_min*60_000))
    assert.ok(timeseries.both_visible.every(value=>typeof value==='boolean'))
    assert.equal(analysis.period_hours,scenario.days*24)
  }
})

test('Simple explanations use the visibility flag supplied by the API', () => {
  assert.equal(explainVisibility('Sun',true,true),'Direct sunlight can reach this site.')
  assert.equal(explainVisibility('Sun',false,true),'Direct sunlight is blocked at this site.')
  assert.equal(explainVisibility('Sun',false,false),'The Sun is below the level horizon.')
  assert.equal(explainVisibility('Earth',true,true),'Earth is geometrically visible from this site.')
})

test('South polar stereographic view rotates true north', () => {
  const [x,y] = gridDirection(-90,0)
  assert.ok(Math.abs(x+1)<1e-12)
  assert.ok(Math.abs(y)<1e-12)
})

test('Globe daylight follows the server directions for both landing sites', () => {
  const sunlight = (siteId,index) => {
    const site = read('sites.json').sites.find(item=>item.id===siteId)
    const {timeseries} = read(siteId.replace(/^Site/,'R')+'/sky.json')
    const observations = { Sun:timeseries.sun_az.map((azimuth,i)=>[azimuth,timeseries.sun_alt[i]]) }
    return lunarDirection(site.lon,site.lat,...directionAt(observations,'Sun',index))
  }
  const facing = lunarDirection(-47,-48,0,90)
  const amounts = Array.from({length:144},(_,i)=>sunlight('Site01',i*10).reduce((dot,axis,j)=>dot+axis*facing[j],0))
  assert.ok(Math.max(...amounts)>0.5)
  assert.ok(Math.min(...amounts)<-0.5)
  const day = sunlight('Site01',720)
  const other = sunlight('Site11',720)
  assert.ok(Math.abs(Math.hypot(...day)-1)<1e-12)
  assert.ok(Math.hypot(...day.map((axis,i)=>axis-other[i]))<0.01)
})
