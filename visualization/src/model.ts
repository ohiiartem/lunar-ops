export interface Site {
  id: string
  name: string
  lat: number
  lon: number
  source: string
  has_terrain: boolean
  data_source: 'jpl_horizons' | 'synthetic_demo' | 'none'
  data_from: string | null
  data_to: string | null
}
export type Target = 'Earth' | 'Sun'
export type Sample = [az: number, elevation: number, horizon: number, visible: boolean]
export type Observations = { times: string[]; bothVisible: boolean[]; terrainUsed: boolean } & Record<Target, Sample[]>
export type Affine = [number, number, number, number, number, number]
export interface Metadata {
  longitude_latitude_deg: [number, number]
  xy_m: [number, number]
  mast_height_m: number
  ground_m?: number
  source_pixel_m?: [number, number]
  frame: string
  heightmaps: Record<string, { affine: Affine; min_m: number; step_m: number; nodata_code: number }>
}
export interface TerrainGrid {
  elevation_m: (number | null)[][]
  affine: Affine
  flat?: boolean
  axes?: { north: [number,number]; east: [number,number] }
}
export const targets: Target[] = ['Earth', 'Sun']
export const names = { Earth: 'Earth', Sun: 'Sun' }
export const colors = { Earth: '#9bdaef', Sun: '#ffd47c' }
export const radians = Math.PI / 180

export function gridDirection(lon: number, azimuth: number): [number, number] {
  // South polar stereographic, central meridian 0°. Axes are +X and +Y of the map.
  const angle = (lon + azimuth) * radians
  return [Math.sin(angle), Math.cos(angle)]
}

export function lunarDirection(lon: number, lat: number, azimuth: number, elevation: number): [number, number, number] {
  const longitude = lon * radians
  const latitude = lat * radians
  const bearing = azimuth * radians
  const altitude = elevation * radians
  const east = Math.sin(bearing) * Math.cos(altitude)
  const north = Math.cos(bearing) * Math.cos(altitude)
  const up = Math.sin(altitude)
  // The globe uses +Y for lunar north and −Z for longitude 90° E.
  const meridian = up * Math.cos(latitude) - north * Math.sin(latitude)
  return [
    meridian * Math.cos(longitude) - east * Math.sin(longitude),
    up * Math.sin(latitude) + north * Math.cos(latitude),
    -meridian * Math.sin(longitude) - east * Math.cos(longitude),
  ]
}

// Interpolate only the displayed direction. Visibility uses the tabulated samples.
export function directionAt(observations: Observations, target: Target, hour: number): [number, number] {
  const rows = observations[target]
  const position = Math.max(0, Math.min(rows.length-1, hour))
  const lower = Math.floor(position)
  const [azimuth, elevation] = rows[lower]
  const [nextAzimuth, nextElevation] = rows[Math.min(lower+1, rows.length-1)]
  const fraction = position-lower
  const arc = ((nextAzimuth-azimuth+540)%360)-180
  return [(azimuth+arc*fraction+360)%360, elevation+(nextElevation-elevation)*fraction]
}

export function explainVisibility(target: Target, visible: boolean, terrainUsed: boolean) {
  if (target === 'Sun') {
    if (visible) return 'Direct sunlight can reach this site.'
    return terrainUsed ? 'Direct sunlight is blocked at this site.' : 'The Sun is below the level horizon.'
  }
  if (visible) return 'Earth is geometrically visible from this site.'
  return terrainUsed ? 'Earth is hidden below the local horizon.' : 'Earth is below the level horizon.'
}

export async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
  return response.json() as Promise<T>
}
