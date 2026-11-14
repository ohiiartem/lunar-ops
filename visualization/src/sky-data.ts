import type { Observations, Site } from './model'

export type DataSource = 'jpl_horizons' | 'synthetic_demo' | 'none'
export interface Scenario {
  site_id: string
  start: string
  days: number
  step_min: number
  use_terrain: boolean
}
export interface TimeSeries {
  site_id: string
  data_source: DataSource
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

export const metricLabels = {
  light_hours: 'Potential sunlight',
  earth_visible_hours: 'Geometric Earth visibility',
  both_hours: 'Sun and Earth visible together',
  longest_darkness_hours: 'Longest darkness',
} as const
type Metric = keyof typeof metricLabels
type EventStatus = 'up_until_set' | 'up_all_period' | 'down_until_rise' | 'down_all_period'
interface Window { from: string; to: string }
export type Analysis = Record<Metric,number> & {
  start: string
  data_source: DataSource
  terrain_used: boolean
  period_hours: number
  light_windows: Window[]
  earth_windows: Window[]
  both_windows: Window[]
  sun_status: EventStatus
  earth_status: EventStatus
  time_to_sunset_h: number | null
  time_to_sunrise_h: number | null
  time_to_earth_set_h: number | null
  time_to_earth_rise_h: number | null
}
export interface Comparison { a: Analysis; b: Analysis; delta: Record<Metric,number>; summary: string }
export type Horizon = [azimuth: number, altitude: number][]
export const dayMs = 86_400_000

class OfflineError extends Error {}

export async function requestAPI<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
  let response: Response
  try {
    response = await fetch('/api/'+path, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      ...(body ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : {}),
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new OfflineError('The API could not be reached.')
  }
  // Dev proxies and static hosts may return an HTML error page when the API is disconnected.
  if (!response.headers.get('content-type')?.includes('application/json')) {
    if ([200,404,500,502,503,504].includes(response.status)) throw new OfflineError('The API is unavailable.')
    throw new Error(`API request failed (HTTP ${response.status}).`)
  }
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error?.message ?? `API request failed (HTTP ${response.status}).`)
  return payload
}

export function assetFolder(id: string) {
  return id.replace(/^Site/, 'R')
}

function parse(payload: TimeSeries, scenario: Scenario) {
  const {t} = payload
  const columns = [payload.sun_az,payload.sun_alt,payload.sun_horizon,payload.sun_visible,
    payload.earth_az,payload.earth_alt,payload.earth_horizon,payload.earth_visible,payload.both_visible]
  if (payload.site_id!==scenario.site_id || !Array.isArray(t) || !t.length ||
    t.length!==scenario.days*1440/scenario.step_min || t.length>5000 ||
    columns.some(column=>!Array.isArray(column)||column.length!==t.length) ||
    t.some((time,i)=>Date.parse(time)!==Date.parse(scenario.start)+i*scenario.step_min*60_000)) {
    throw new Error('The API returned an invalid observation grid.')
  }
  const observations: Observations = {
    times: t.map(time=>new Date(time).toISOString().slice(0,16).replace('T',' ')),
    bothVisible: payload.both_visible,
    terrainUsed: payload.terrain_used,
    Sun: t.map((_,i)=>[payload.sun_az[i],payload.sun_alt[i],payload.sun_horizon[i],payload.sun_visible[i]]),
    Earth: t.map((_,i)=>[payload.earth_az[i],payload.earth_alt[i],payload.earth_horizon[i],payload.earth_visible[i]]),
  }
  const horizon: Horizon = payload.terrain_used && payload.horizon
    ? payload.horizon.azimuth_deg.map((azimuth,i)=>[azimuth,payload.horizon!.horizon_deg[i]]) : []
  return {observations,horizon}
}

interface Snapshot { scenario: Scenario; timeseries: TimeSeries; analysis: Analysis }
interface Catalogue { sites: Site[] }

export async function loadSites(signal: AbortSignal) {
  try {
    const {sites} = await requestAPI<Catalogue>('sites',signal)
    return {sites,offline:false}
  } catch (error) {
    if (!(error instanceof OfflineError)) throw error
    const response = await fetch(import.meta.env.BASE_URL+'data/sites.json',{signal})
    if (!response.ok) throw error
    const {sites} = await response.json() as Catalogue
    return {sites,offline:true}
  }
}

export async function loadScenario(scenario: Scenario, url: string, signal: AbortSignal) {
  const outcomes = await Promise.allSettled([
    requestAPI<TimeSeries>('timeseries',signal,scenario),
    requestAPI<Analysis>('analyze',signal,scenario),
  ])
  const fatal = outcomes.find(result=>result.status==='rejected' && !(result.reason instanceof OfflineError))
  if (fatal?.status==='rejected') throw fatal.reason
  const [series,metrics] = outcomes
  if (series.status==='fulfilled' && metrics.status==='fulfilled') {
    return {...parse(series.value,scenario),analysis:metrics.value,offline:false,
      demo:[series.value.data_source,metrics.value.data_source].includes('synthetic_demo')}
  }
  const response = await fetch(url+'sky.json',{signal}).catch(()=>undefined)
  if (!response?.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('API unavailable. There is no offline snapshot for this site.')
  }
  const saved = await response.json() as Snapshot
  if (!(Object.keys(scenario) as (keyof Scenario)[]).every(key=>scenario[key]===saved.scenario[key])) {
    throw new Error(`API unavailable. The saved scenario starts on ${saved.scenario.start.slice(0,10)}, runs for ${saved.scenario.days} days and uses ${saved.scenario.step_min}-minute steps.`)
  }
  return {...parse(saved.timeseries,scenario),analysis:saved.analysis,offline:true,demo:false}
}
