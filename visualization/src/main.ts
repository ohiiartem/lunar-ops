import './style.css'
import { renderAnalysis, updateAnalysisCursor } from './analysis'
import { createSky } from './sky-view'
import { loadSkyData } from './sky-data'
import type { Horizon } from './sky-data'
import { mapNavigation } from './map-navigation'
import { colors, compare, directionAt, gridDirection, names, readJson, targets } from './model'
import type { Metadata, Observations, Site } from './model'
import type { SystemBody } from './solar-system'

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const site = element<HTMLSelectElement>('site')
const hour = element<HTMLInputElement>('hour')
const playButton = element<HTMLButtonElement>('play-timeline')
const map = element<HTMLImageElement>('map-image')
const overlay = document.querySelector<SVGSVGElement>('#map-overlay')!
const mapButton = element<HTMLButtonElement>('map-button')
const terrainButton = element<HTMLButtonElement>('terrain-button')
const terrainView = element('terrain-view')
let mapPixels = 0
const resetMap = mapNavigation(pixels => { mapPixels = pixels; renderScale() })
const status = element('status')
const results = element('results')

type Data = { url: string; metadata: Metadata; observations: Observations; horizon: Horizon; heights?: Promise<DataView> }
let current: Data | undefined
let terrain: Awaited<ReturnType<typeof import('./terrain')['createTerrain']>> | undefined
type View = 'map'|'terrain'|'sky'|'surface'
let view: View = 'map'
let sky: ReturnType<typeof createSky> | undefined
let analyzed: Observations | undefined
const dayRange = element<HTMLInputElement>('day-range')
const dayTime = element<HTMLInputElement>('day-time')
const playSpeed = element<HTMLSelectElement>('play-speed')
let revision = 0
let siteLoading: AbortController | undefined
const heightCodes = new Map<string, DataView>()
const exaggeration = element<HTMLSelectElement>('exaggeration')
const wireframe = element<HTMLInputElement>('wireframe')
const directions = element<HTMLInputElement>('directions')
const layer = element<HTMLSelectElement>('map-layer')
const missionTime = element<HTMLInputElement>('mission-time')
const analysis = element<HTMLDetailsElement>('analysis')
const asset = (id: Site) => `${import.meta.env.BASE_URL}data/${id}/`

function loadHeights(data: Data): Promise<DataView> {
  const cached = heightCodes.get(data.url)
  if (cached) return Promise.resolve(cached)
  if (!data.heights) {
    data.heights = fetch(data.url+'terrain-512.bin', { signal: siteLoading?.signal }).then(async response => {
      if (!response.ok) throw new Error('Height data unavailable')
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength!==512*512*2) throw new Error('Invalid terrain grid size')
      const view = new DataView(buffer)
      heightCodes.set(data.url,view)
      return view
    }).catch(error => {
      data.heights = undefined
      throw error
    })
  }
  return data.heights
}

function renderScale() {
  if (!current || !mapPixels) return
  const pixelMeters = current.metadata.heightmaps['512'].affine[0]*512/mapPixels
  const limit = pixelMeters*95
  const decade = 10**Math.floor(Math.log10(limit))
  const length = ([5,2,1].find(n=>n*decade<=limit) ?? 1)*decade
  element('scale-line').style.width = `${length/pixelMeters}px`
  element('scale-label').textContent = length>=1000?`${length/1000} km`:`${length} m`
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
let visualHour = Number(hour.value)
let frame = 0
let playing = false

function updatePlayButton() {
  const label = playing ? 'Pause timeline' : 'Play timeline'
  playButton.textContent = playing ? 'Ⅱ' : '▶'
  playButton.setAttribute('aria-label', label)
  playButton.title = label
}

function stopPlayback() {
  cancelAnimationFrame(frame)
  frame = 0
  playing = false
  updatePlayButton()
}

function drawDirections() {
  if (!current) return
  if (analysis.open) updateAnalysisCursor(current.observations,visualHour)
  if (settings.dataset.mode === 'system') {
    const initialTime = Date.parse(current.observations.times[0].replace(' ','T')+'Z')
    const index = reducedMotion.matches ? Number(hour.value) : visualHour
    system?.update(initialTime+index*30*60_000)
    return
  }
  if (settings.dataset.mode === 'globe') return
  if (view === 'map') renderMap(current, visualHour)
  else if (view==='terrain') terrain?.update(current.observations, reducedMotion.matches ? Number(hour.value) : visualHour)
  else sky?.update(reducedMotion.matches ? Number(hour.value) : visualHour,Number(hour.value),directions.checked)
}

function selectHour(index: number) {
  const start = visualHour
  stopPlayback()
  index = Math.max(0,Math.min(Number(hour.max),index))
  hour.value = String(index)
  if (reducedMotion.matches || settings.dataset.mode==='globe' || Math.abs(index-start)>48) visualHour = index
  render()
  if (visualHour === index) return
  const started = performance.now()
  const step = (now: number) => {
    const progress = Math.min(1,(now-started)/220)
    visualHour = start+(index-start)*progress*(2-progress)
    drawDirections()
    frame = progress<1 ? requestAnimationFrame(step) : 0
  }
  frame = requestAnimationFrame(step)
}

function renderMap(data: Data, position: number) {
  const { metadata, observations } = data
  const [dx, , x0, , dy, y0] = metadata.heightmaps['512'].affine
  const [x, y] = metadata.xy_m
  const u = (x - x0) / dx
  const v = (y - y0) / dy
  if (!overlay.hasChildNodes()) {
    overlay.innerHTML = targets.map(target => `<g data-direction="${target}">
      <defs><marker id="tip-${target}" markerWidth="6" markerHeight="6" refX="8" refY="4" viewBox="0 0 8 8" orient="auto">
        <path d="M0 0L8 4L0 8Z" fill="${colors[target]}"/></marker></defs>
      <line x1="${u}" y1="${v}" stroke="${colors[target]}" stroke-width="2.5" marker-end="url(#tip-${target})"/>
      <g class="direction-tip">
      <text x="0" y="-11" text-anchor="middle" fill="${colors[target]}">${names[target]}</text></g>
      </g>`).join('') + `<circle cx="${u}" cy="${v}" r="5" fill="white" stroke="#17212a" stroke-width="2"/>`
  }
  for (const target of targets) {
    const group = overlay.querySelector<SVGGElement>(`[data-direction="${target}"]`)!
    group.style.display = directions.checked ? '' : 'none'
    if (!directions.checked) continue
    const [azimuth,elevation] = directionAt(observations,target,reducedMotion.matches ? Number(hour.value) : position)
    const [east,north] = gridDirection(metadata.longitude_latitude_deg[0],azimuth)
    const length = 90*Math.cos(elevation*Math.PI/180)
    const tipX = u+length*east, tipY = v-length*north
    const line = group.querySelector('line')!
    line.setAttribute('x2',String(tipX))
    line.setAttribute('y2',String(tipY))
    const blocked = compare(observations[target][Number(hour.value)]).local === false
    line.setAttribute('stroke-dasharray',blocked ? '4 3' : 'none')
    group.querySelector('.direction-tip')!.setAttribute('transform',
      `translate(${tipX+20*east} ${tipY-20*north})`)
  }
}

function visibility(value: boolean | null) {
  if (value === null) return '<span>Data unavailable</span>'
  return value ? '<strong class="yes">Visible</strong>' : '<strong class="no">Obscured</strong>'
}

function render() {
  if (!current) return
  const i = Number(hour.value)
  const { observations } = current
  const time = observations.times[i]
  missionTime.value = time.replace(' ','T')
  dayRange.value = String(Math.floor(i/48))
  dayTime.max = String(Math.min(47,observations.times.length-1-Math.floor(i/48)*48))
  dayTime.value = String(i%48)
  dayTime.setAttribute('aria-valuetext', time.slice(11)+' UTC')
  dayRange.setAttribute('aria-valuetext', time.slice(0,10))
  element('date').textContent = `· ${time} UTC`
  element('mission-date').textContent = `${time} UTC`
  if (analysis.open && analyzed!==observations) {
    renderAnalysis(observations,selectHour)
    analyzed=observations
  }
  element('comparison').innerHTML = targets.map(target => {
    const sample = observations[target][i]
    const verdict = compare(sample)
    const angle = (value: number | null) => value === null ? '—' : `${value.toFixed(2)}°`
    return `<div class="object">
      <div class="body-head"><h3 style="color:${colors[target]}">${names[target]}</h3><small>AZ ${angle(sample[0])} · EL ${angle(sample[1])}</small></div>
      <div class="row"><span>Reference horizon · 0°</span>${visibility(verdict.flat)}</div>
      <div class="row"><span>Terrain horizon · ${angle(sample[2])}</span>${visibility(verdict.local)}</div>
      <div class="row"><small>Center clearance</small><span>${angle(verdict.margin)}</span></div>
      </div>`
  }).join('')
  if (settings.dataset.mode==='system') renderSystemAngles()
  drawDirections()
}

function setView(next: View) {
  view = next
  element('terrain-tools').hidden = next!=='terrain'
  element('terrain-caption').hidden = next!=='terrain'
  element('surface-tools').hidden = next!=='surface'
  element('map-readouts').hidden = next!=='map'
  element('map-layer-controls').hidden = next!=='map'
  for (const name of ['map','terrain','sky','surface'] as const) {
    element(name+'-view').hidden = name!==next
    element(name+'-button').setAttribute('aria-pressed',String(name===next))
  }
  if (next!=='terrain') { terrain?.dispose();terrain=undefined }
  if (next!=='sky'&&next!=='surface') sky=undefined
  element('view-help').textContent = {
    map:'Map top is grid +Y',
    terrain:'Drag to orbit · Click the terrain to see the sky from the landing marker',
    sky:'Sun and Earth move in azimuth and altitude as time advances',
    surface:'Drag or use the arrow keys to look around the landing site',
  }[next]
}

function showMap() {
  setView('map')
  render()
}

function openSky(surface = false) {
  if (!current) return
  ++revision
  const next = surface ? 'surface' : 'sky'
  setView(next)
  sky = createSky(element(next+'-view'),surface,current.observations,current.horizon,Number(hour.value))
  render()
}

async function openTerrain() {
  if (!current || view === 'terrain') return
  const data = current
  const request = ++revision
  setView('terrain')
  terrainView.textContent = 'Loading 3D terrain…'
  status.textContent = ''
  try {
    const module = await import('./terrain')
    if (request !== revision) return
    const heights = await loadHeights(data)
    const grid = module.decodeTerrain(heights, data.metadata)
    if (request !== revision) return
    terrainView.replaceChildren()
    terrain = module.createTerrain(terrainView, data.metadata, grid, () => openSky(true))
    syncTerrain()
    render()
  } catch (error) {
    if (request !== revision) return
    showMap()
    status.textContent = '3D terrain is unavailable. You can still explore the 2D map.'
    console.error(error)
  }
}

function syncTerrain() {
  terrain?.style(Number(exaggeration.value),wireframe.checked,directions.checked)
}

async function selectSite() {
  stopPlayback()
  playButton.disabled = true
  visualHour = Number(hour.value)
  siteLoading?.abort()
  const loader = new AbortController()
  siteLoading = loader
  const request = ++revision
  const previousView = view
  current = undefined
  resetMap()
  showMap()
  results.hidden = false
  element('site-facts').replaceChildren()
  element('comparison').replaceChildren()
  element('timeline').replaceChildren()
  element('intervals').replaceChildren()
  overlay.replaceChildren()
  map.removeAttribute('src')
  element('height-range').textContent = ''
  element('scale-label').textContent = ''
  element('map-sample').textContent = ''
  element('date').textContent = ''
  missionTime.value = ''
  hour.disabled = missionTime.disabled = true
  element('active-site').textContent = site.selectedOptions[0].textContent
  status.textContent = 'Loading landing site…'
  const url = asset(site.value as Site)
  try {
    const [metadata, skyData] = await Promise.all([
      readJson<Metadata>(url + 'metadata.json', loader.signal),
      loadSkyData(site.value as Site,url,loader.signal),
    ])
    if (request !== revision) return
    const {observations,horizon,source} = skyData
    current = { url, metadata, observations, horizon }
    dayRange.max = String(Math.floor((observations.times.length-1)/48))
    hour.max = String(observations.times.length - 1)
    hour.disabled = missionTime.disabled = playButton.disabled = false
    visualHour = Number(hour.value)
    missionTime.min = observations.times[0].replace(' ','T')
    missionTime.max = observations.times.at(-1)!.replace(' ','T')
    if (settings.dataset.mode === 'terrain') map.src = url + layer.value
    element('period-start').textContent = observations.times[0].slice(0,10)
    element('period-end').textContent = observations.times.at(-1)!.slice(0,10)
    element('active-site').textContent = site.selectedOptions[0].textContent
    const [lon,lat] = metadata.longitude_latitude_deg
    const east = (lon+360)%360
    const height = metadata.heightmaps['512']
    const maximum = height.min_m+65534*height.step_m
    element('site-facts').innerHTML = `<dt>Latitude / longitude</dt><dd>${lat.toFixed(4)}° / ${east.toFixed(4)}° E</dd>
      <dt>Terrain elevation</dt><dd>${metadata.ground_m?.toFixed(1) ?? 'Data unavailable'}${metadata.ground_m===undefined?'':' m'}</dd>
      <dt>Source DEM</dt><dd>NASA LOLA · ${metadata.source_pixel_m?.[0] ?? '—'} m/px</dd>
      <dt>Display sampling</dt><dd>${height.affine[0].toFixed(2)} m/px</dd>
      <dt>Reference frame</dt><dd>MOON_ME / DE421</dd>
      <dt>Sky observations</dt><dd>${source}</dd>`
    element('height-range').textContent = `${height.min_m.toFixed(0)} — ${maximum.toFixed(0)} m`
    element('map-sample').textContent = 'Move over the map to sample elevation'
    renderScale()
    results.hidden = false
    status.textContent = ''
    if (settings.dataset.mode==='terrain' && previousView==='terrain') void openTerrain()
    else if (settings.dataset.mode==='terrain' && (previousView==='sky'||previousView==='surface')) openSky(previousView==='surface')
    else render()

  } catch (error) {
    if (request !== revision) return
    status.textContent = 'Landing site data is unavailable.'
    console.error(error)
  }
}

mapButton.addEventListener('click', () => {
  if (!current) return
  ++revision
  status.textContent = ''
  showMap()
})
terrainButton.addEventListener('click', openTerrain)
element('sky-button').onclick = () => openSky()
element('surface-button').onclick = () => openSky(true)
element('terrain-surface').onclick = () => openSky(true)
element('surface-left').onclick = () => sky?.turn(-30)
element('surface-right').onclick = () => sky?.turn(30)
element('advance-day').onclick = () => selectHour(Number(hour.value)+48)
element('advance-five').onclick = () => selectHour(Number(hour.value)+240)
const selectDayTime = () => selectHour(Number(dayRange.value)*48+Number(dayTime.value))
dayRange.oninput = dayTime.oninput = selectDayTime
site.addEventListener('change', () => {
  void selectSite()
  ++navigation
  entering = false
  overview.classList.remove('travelling')
  if (settings.dataset.mode === 'globe') void globe.then(world => world?.focus(site.value as Site, false))
})
hour.addEventListener('input', () => selectHour(Number(hour.value)))
playButton.onclick = () => {
  if (playing) { stopPlayback(); visualHour = Number(hour.value); drawDirections(); return }
  if (!current) return
  stopPlayback()
  const last = Number(hour.max)
  if (Number(hour.value) >= last) selectHour(0)
  stopPlayback()
  playing = true
  updatePlayButton()
  visualHour = Number(hour.value)
  let previous = performance.now()
  const step = (now: number) => {
    visualHour = Math.min(last,visualHour+(now-previous)*Number(playSpeed.value)/1000)
    previous = now
    const sampleHour = Math.floor(visualHour)
    if (sampleHour !== Number(hour.value)) {
      hour.value = String(sampleHour)
      render()
    } else drawDirections()
    if (visualHour < last) frame = requestAnimationFrame(step)
    else stopPlayback()
  }
  frame = requestAnimationFrame(step)
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopPlayback(); visualHour = Number(hour.value); drawDirections() }
})
element('previous-hour').onclick=()=>selectHour(Math.max(Number(hour.min),Number(hour.value)-1))
element('next-hour').onclick=()=>selectHour(Math.min(Number(hour.max),Number(hour.value)+1))
analysis.addEventListener('toggle', render)
missionTime.addEventListener('change', () => {
  if (!current) return
  const i = current.observations.times.indexOf(missionTime.value.replace('T',' '))
  if (i>=0) { status.textContent='';selectHour(i) }
  else { render();status.textContent='Choose a UTC time from the available half-hour observations.' }
})
layer.addEventListener('change', () => {
  if (current) map.src = current.url+layer.value
  element('height-legend').hidden = layer.value!=='elevation.webp'
})
for (const input of [exaggeration,wireframe,directions]) input.addEventListener('change', () => { syncTerrain();render() })
element('terrain-in').onclick = () => terrain?.zoom(.8)
element('terrain-out').onclick = () => terrain?.zoom(1.25)
element('terrain-reset').onclick = () => terrain?.reset()
element('map-stage').addEventListener('pointerenter', () => {
  if (current) void loadHeights(current).catch(() => {})
})
element('map-stage').addEventListener('pointermove', event => {
  if (!current) return
  const rect=map.getBoundingClientRect()
  const col=Math.floor((event.clientX-rect.left)/rect.width*512)
  const row=Math.floor((event.clientY-rect.top)/rect.height*512)
  if (col<0||row<0||col>=512||row>=512) return
  const code=heightCodes.get(current.url)?.getUint16(2*(row*512+col),true)
  const info=current.metadata.heightmaps['512']
  const [dx,,x0,,dy,y0]=info.affine
  const x=x0+(col+.5)*dx, y=y0+(row+.5)*dy
  const lat=-90+2*Math.atan(Math.hypot(x,y)/(2*1737400))*180/Math.PI
  const lon=(Math.atan2(x,y)*180/Math.PI+360)%360
  const z=code===undefined||code===info.nodata_code?'Data unavailable':`${(info.min_m+(code-1)*info.step_m).toFixed(1)} m`
  element('map-sample').textContent=`${lat.toFixed(4)}° / ${lon.toFixed(4)}° E · ${z}`
})
const overview = element('overview')
const settings = element('site-settings')
const moonCatalog = element<HTMLDetailsElement>('moon-catalog')
const globe = import('./globe').then(module => module.createGlobe(element('moon-globe'),element('moon-catalog-items'),enterSite)).catch(error => {
  element('moon-globe').textContent = 'The globe is unavailable. Use Explore terrain to open the site.'
  element('moon-catalog').hidden = true
  console.error(error)
  return undefined
})
const floatingToggle = element<HTMLButtonElement>('globe-floating')
void globe.then(world => {
  if (!world) return
  moonCatalog.hidden = settings.dataset.mode!=='globe'
  const { floating } = world
  const sync = () => {
    const reduced = floating.reducedMotion.matches
    floatingToggle.disabled = reduced
    floatingToggle.setAttribute('aria-pressed', String(floating.enabled && !reduced))
    floatingToggle.textContent = `Floating Moon: ${floating.enabled && !reduced ? 'ON' : 'OFF'}`
    floatingToggle.title = reduced ? 'Paused by your reduced motion preference' : ''
  }
  floatingToggle.onclick = () => { floating.setEnabled(!floating.enabled); sync() }
  floating.reducedMotion.addEventListener('change', sync)
  sync()
})
let navigation = 0
let entering = false
const workspace = element('mission-workspace')
const fullscreenButtons = [element('fullscreen'),element('globe-fullscreen'),element('system-fullscreen')]

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement === workspace) await document.exitFullscreen()
    else await workspace.requestFullscreen()
  } catch { status.textContent = 'Fullscreen is unavailable.' }
}

for (const button of fullscreenButtons) button.onclick = toggleFullscreen
document.addEventListener('fullscreenchange', () => {
  const active = document.fullscreenElement === workspace
  const label = active ? 'Exit fullscreen' : 'Enter fullscreen'
  for (const button of fullscreenButtons) {
    button.setAttribute('aria-label', label)
    button.title = label
  }
  fullscreenButtons[0].textContent = active ? 'Exit fullscreen' : 'Fullscreen'
})


const systemHost = element('solar-scene')
let system: Awaited<ReturnType<typeof import('./solar-system')['createSolarSystem']>> | undefined
let previousMode: 'globe'|'terrain' = 'globe'
let systemRequest = 0

async function openSystem() {
  if (settings.dataset.mode === 'system' || entering || !current) return
  ++navigation
  ++revision
  entering = false
  previousMode = settings.dataset.mode==='terrain'?'terrain':'globe'
  showMap()
  setMode('system')
  selectSystemBody()
  systemSite.value = site.value
  const mount = document.createElement('div')
  mount.className = 'system-mount'
  mount.textContent = 'Loading the solar system…'
  systemHost.replaceChildren(mount)
  const request = ++systemRequest
  void globe.then(world=>{ if (settings.dataset.mode==='system') world?.suspend() })
  try {
    const module = await import('./solar-system')
    if (request !== systemRequest) return
    const created = await module.createSolarSystem(mount,activateSystemBody)
    if (request !== systemRequest) { created.dispose(); return }
    system = created
    drawDirections()
  } catch (error) {
    if (request === systemRequest) mount.textContent = 'The 3D solar system is unavailable.'
    console.error(error)
  }
}

function closeSystem(destination = previousMode) {
  if (settings.dataset.mode !== 'system') return
  ++systemRequest
  system?.dispose()
  system = undefined
  setMode(destination)
  if (destination==='globe') void globe.then(world=>world?.reset())
  else if (current) map.src=current.url+layer.value
  render()
  element('system-open').focus({preventScroll:true})
}

element('system-open').onclick = () => {
  if (settings.dataset.mode==='system') closeSystem()
  else void openSystem()
}
element('system-back').onclick = () => closeSystem()
element('system-reset').onclick = () => { selectSystemBody(); system?.reset() }

let selectedBody: Exclude<SystemBody,'Moon'> | undefined
const bodyButtons = document.querySelectorAll<HTMLButtonElement>('#system-panel [data-body]')
const systemSite = element<HTMLSelectElement>('system-site')
const systemDescriptions = {
  Sun: 'The Sun sits at the center of this view. The panel shows where it appears from the selected landing site.',
  Earth: 'Follow Earth around the Sun. The panel shows where Earth appears in the sky from the selected lunar site.',
}

function renderSystemAngles() {
  const rows = element('system-coordinates')
  rows.replaceChildren()
  if (!current || !selectedBody) return
  const sample = current.observations[selectedBody][Number(hour.value)]
  const local = compare(sample).local
  rows.innerHTML = `<div><dt>Azimuth</dt><dd>${sample[0].toFixed(2)}°</dd></div>
    <div><dt>Elevation</dt><dd>${sample[1].toFixed(2)}°</dd></div>
    <div><dt>Terrain visibility</dt><dd>${local===null?'Data unavailable':local?'Visible':'Obscured'}</dd></div>`
}

function selectSystemBody(body?: Exclude<SystemBody,'Moon'>) {
  selectedBody = body
  for (const button of bodyButtons) {
    if (button.dataset.body!=='Moon') button.setAttribute('aria-pressed',String(button.dataset.body===body))
  }
  element('system-name').textContent = body ?? 'Sun, Earth and Moon'
  element('system-description').textContent = body ? systemDescriptions[body] : 'Follow Earth around the Sun and the Moon around Earth. Select the Moon to open the lunar globe.'
  const preview = element<HTMLImageElement>('system-preview')
  preview.hidden = body!=='Earth'
  if (!preview.hidden) preview.src=import.meta.env.BASE_URL+'earth-atmos.jpg'
  renderSystemAngles()
  if (body) system?.focus(body)
}

function activateSystemBody(body: SystemBody) {
  if (body==='Moon') {
    closeSystem('globe')
    element<HTMLDetailsElement>('site-details').open = false
    moonCatalog.open = true
    element('globe-pole').focus({preventScroll:true})
    void globe.then(world=>{
      if (settings.dataset.mode==='globe') return world?.showSouthPole()
    })
    return
  }
  selectSystemBody(body)
}

for (const button of bodyButtons) {
  button.onclick=()=>activateSystemBody(button.dataset.body as SystemBody)
}
systemSite.onchange=()=>{
  site.value = systemSite.value
  element('system-coordinates').textContent = 'Loading observation site…'
  void selectSite()
}

function setMode(mode: 'globe'|'terrain'|'system') {
  settings.dataset.mode = mode
  overview.hidden = mode !== 'globe'
  element('viewer').hidden = mode !== 'terrain'
  element('system-view').hidden = mode !== 'system'
  element('system-panel').hidden = mode !== 'system'
  element('local-layers').hidden = mode !== 'terrain'
  element('explore').hidden = mode !== 'globe'
  moonCatalog.hidden = mode !== 'globe' || !element('moon-catalog-items').hasChildNodes()
  element('return-globe').hidden = mode !== 'terrain'
  element('system-open').setAttribute('aria-pressed',String(mode==='system'))
}

async function enterSite(id: Site) {
  if (entering) return
  entering = true
  const request = ++navigation
  site.value = id
  const ready = selectSite().then(async () => {
    if (request !== navigation || !current) return
    map.src = current.url+layer.value
    await map.decode()
  }).then(() => Boolean(current), () => false)

  const world = await Promise.race([globe, new Promise<undefined>(resolve => setTimeout(resolve, 1200))])
  if (request !== navigation) return
  const [, loaded] = await Promise.all([world?.focus(id), ready])
  if (request !== navigation) return
  if (!loaded) {
    entering = false
    world?.reset()
    status.textContent = 'Terrain map could not be loaded. Try opening the site again.'
    return
  }

  const viewer = element('viewer')
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (world && !reducedMotion) {
    // Keep both views in the same scene slot until the handoff finishes.
    if (current) renderMap(current, Number(hour.value))
    settings.classList.add('terrain-handoff')
    viewer.hidden = false
    const outgoing = overview.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: 320, easing: 'ease-in-out', fill: 'forwards' })
    const incoming = viewer.animate([{ opacity: 0 }, { opacity: 1 }],
      { duration: 320, easing: 'ease-in-out' })
    await incoming.finished
    outgoing.cancel()
    settings.classList.remove('terrain-handoff')
    if (request !== navigation) { viewer.hidden = settings.dataset.mode==='globe'; return }
  }
  world?.suspend()
  setMode('terrain')
  entering = false
  openSky()
  element('sky-button').focus({ preventScroll: true })
}

element('explore').onclick=()=>{ void enterSite(site.value as Site) }
element('globe-in').onclick=()=>{ void globe.then(world=>world?.zoom(.78)) }
element('globe-out').onclick=()=>{ void globe.then(world=>world?.zoom(1.28)) }
element('globe-reset').onclick=()=>{
  ++navigation
  entering = false
  overview.classList.remove('travelling')
  void globe.then(world=>world?.reset())
}
element('globe-pole').onclick=()=>{
  ++navigation
  entering = false
  overview.classList.remove('travelling')
  void globe.then(world=>world?.focus('pole', false))
}
element('return-globe').onclick=()=>{
  ++navigation
  ++revision
  stopPlayback()
  visualHour = Number(hour.value)
  showMap()
  setMode('globe')
  void globe.then(world=>world?.reset())
  element('explore').focus({preventScroll:true})
}
void selectSite()
