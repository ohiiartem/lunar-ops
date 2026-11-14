export type Site = 'R01' | 'R11'
export type Target = 'Earth' | 'Sun'
export type Sample = [az: number, elevation: number, horizon: number | null, flat: 0 | 1, local: 0 | 1 | null]
export type Observations = { times: string[]; bothVisible?: boolean[] } & Record<Target, Sample[]>
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

export function compare(sample: Sample) {
  const [, elevation, horizon, flat, local] = sample
  return { flat: Boolean(flat), local: local === null ? null : Boolean(local),
    margin: horizon === null ? null : elevation - horizon }
}

export async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
  return response.json() as Promise<T>
}
