import type { Observations, Site } from './model'

interface TimeSeries {
  site_id: string
  data_source: string
  terrain_used: boolean
  t: string[]
  sun_az: number[]
  sun_alt: number[]
  sun_horizon: number[]
  sun_visible: boolean[]
  earth_az: number[]
  earth_alt: number[]
  earth_horizon: number[]
  earth_visible: boolean[]
  both_visible: boolean[]
  horizon?: { azimuth_deg: number[]; horizon_deg: number[] }
}

export type Horizon = [azimuth: number, altitude: number][]

function parse(payload: TimeSeries, siteId: string) {
  const columns = [payload.sun_az,payload.sun_alt,payload.sun_horizon,payload.sun_visible,
    payload.earth_az,payload.earth_alt,payload.earth_horizon,payload.earth_visible,payload.both_visible]
  if (payload.site_id!==siteId || payload.data_source!=='jpl_horizons' || !Array.isArray(payload.t)
    || !payload.t.length || columns.some(column=>!Array.isArray(column)||column.length!==payload.t.length)) {
    throw new Error('Unexpected observing data')
  }
  if (payload.t.some((time,i)=>!Number.isFinite(Date.parse(time)) ||
    (i>0 && Date.parse(time)-Date.parse(payload.t[i-1])!==30*60_000))) throw new Error('Invalid observing grid')
  if ([payload.sun_az,payload.sun_alt,payload.earth_az,payload.earth_alt].some(col=>col.some(value=>!Number.isFinite(value)))) {
    throw new Error('Invalid observing angles')
  }
  const observations: Observations = {
    times: payload.t.map(time=>new Date(time).toISOString().slice(0,16).replace('T',' ')),
    bothVisible: payload.both_visible,
    Sun: payload.t.map((_,i)=>[payload.sun_az[i],payload.sun_alt[i],payload.sun_horizon[i],
      payload.sun_alt[i]+.27>0?1:0,payload.sun_visible[i]?1:0]),
    Earth: payload.t.map((_,i)=>[payload.earth_az[i],payload.earth_alt[i],payload.earth_horizon[i],
      payload.earth_alt[i]>0?1:0,payload.earth_visible[i]?1:0]),
  }
  const horizon: Horizon = (payload.terrain_used ? payload.horizon?.azimuth_deg : undefined)
    ?.flatMap((azimuth,i) => {
      const altitude = payload.horizon?.horizon_deg[i]
      return Number.isFinite(azimuth) && typeof altitude==='number' && Number.isFinite(altitude)
        ? [[azimuth,altitude] as [number,number]] : []
    }) ?? []
  return { observations,horizon }
}

export async function loadSkyData(site: Site, url: string, signal: AbortSignal) {
  const siteId = 'Site'+site.slice(1)
  if (import.meta.env.DEV) {
    try {
      const response = await fetch('/api/timeseries', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({site_id:siteId,start:'2026-11-07T00:00:00Z',days:30,step_min:30,use_terrain:true}),
        signal:AbortSignal.any([signal,AbortSignal.timeout(1800)]),
      })
      if (!response.ok) throw new Error('Observing API unavailable')
      return {...parse(await response.json(),siteId),source:'JPL Horizons · API'}
    } catch (error) {
      if (signal.aborted) throw error
    }
  }
  const response = await fetch(url+'sky.json',{signal})
  if (!response.ok) throw new Error('Observing data unavailable')
  return {...parse(await response.json(),siteId),source:'JPL Horizons · offline snapshot'}
}
