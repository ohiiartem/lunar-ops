import './style.css'
import { renderAnalysis, updateAnalysisCursor } from './analysis'
import { createSky } from './sky-view'
import { assetFolder, dayMs, loadScenario, loadSites, requestAPI } from './sky-data'
import type { Comparison, Scenario } from './sky-data'
import { showComparison, showMetrics } from './mission'
import { mapNavigation } from './map-navigation'
import { colors, directionAt, explainVisibility, gridDirection, lunarDirection, names, readJson, targets } from './model'
import type { Metadata, Observations, Site } from './model'
import type { SystemBody } from './solar-system'

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const site = element<HTMLSelectElement>('site')
const hour = element<HTMLInputElement>('hour')
const playButton = element<HTMLButtonElement>('play-timeline')
const playLabel = element('play-label')
const workspace = element('mission-workspace')
const modeButtons = { simple: element<HTMLButtonElement>('mode-simple'), expert: element<HTMLButtonElement>('mode-expert') }
type DetailMode = keyof typeof modeButtons
const detailPreference = 'lunar-ops:detail-mode'
const map = element<HTMLImageElement>('map-image')
const overlay = document.querySelector<SVGSVGElement>('#map-overlay')!
const mapButton = element<HTMLButtonElement>('map-button')
const terrainButton = element<HTMLButtonElement>('terrain-button')
const terrainView = element('terrain-view')
let mapPixels = 0
const resetMap = mapNavigation(pixels => { mapPixels = pixels; renderScale() })
const status = element('status')

type Data = Awaited<ReturnType<typeof loadScenario>> & {
  site: Site; url: string; scenario: Scenario; metadata?: Metadata; heights?: Promise<DataView>
}
let catalogue: Site[] = []
let catalogueOffline = false
let demoSeen = false
let comparisonLoading: AbortController | undefined
const startDate = element<HTMLInputElement>('scenario-start')
const daysInput = element<HTMLInputElement>('scenario-days')
const stepSelect = element<HTMLSelectElement>('scenario-step')
const terrainInput = element<HTMLInputElement>('scenario-terrain')
const analyzeButton = element<HTMLButtonElement>('analyze')
const shiftButtons = document.querySelectorAll<HTMLButtonElement>('[data-shift]')
const metrics = element('mission-metrics')
const shiftResults = element('shift-results')
const shiftStatus = element('shift-status')
const defaultStart = '2026-11-14T00:00:00Z'
const dateOnly = (time: number) => new Date(time).toISOString().slice(0,10)
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
let current: Data | undefined
let terrain: Awaited<ReturnType<typeof import('./terrain')['createTerrain']>> | undefined
type View = 'map'|'terrain'|'sky'|'surface'
let view: View = 'map'
let mapSky: ReturnType<typeof createSky> | undefined
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
const analysis = element<HTMLDetailsElement>('analysis')
const asset = (id: string) => `${import.meta.env.BASE_URL}data/${encodeURIComponent(assetFolder(id))}/`

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
  if (!current?.metadata || !mapPixels) return
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
  playButton.dataset.playing = String(playing)
  playLabel.textContent = playing ? 'Pause' : 'Play'
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
  const { observations } = current
  const index = reducedMotion.matches ? Number(hour.value) : visualHour
  if (workspace.dataset.detail==='expert' && analysis.open) updateAnalysisCursor(observations,visualHour)
  if (settings.dataset.mode === 'system') {
    const initialTime = Date.parse(observations.times[0].replace(' ','T')+'Z')
    if (system) element('orbit-coverage').hidden = system.update(initialTime+index*current.scenario.step_min*60_000)
    return
  }
  if (settings.dataset.mode === 'globe') {
    if (lunarGlobe) {
      lunarGlobe.setSunDirection(...lunarDirection(current.site.lon,current.site.lat,...directionAt(observations,'Sun',index)))
    }
    return
  }
  if (view === 'map') {
    renderMap(current, index)
    mapSky?.update(index,Number(hour.value),true)
  }
  else if (view==='terrain') terrain?.update(observations,index)
  else sky?.update(index,Number(hour.value),directions.checked)
}

function selectHour(index: number) {
  const start = visualHour
  stopPlayback()
  index = Math.max(0,Math.min(Number(hour.max),index))
  hour.value = String(index)
  if (reducedMotion.matches || Math.abs(index-start)>48) visualHour = index
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
  if (!metadata) return
  const [dx, , x0, , dy, y0] = metadata.heightmaps['512'].affine
  const [x, y] = metadata.xy_m
  const u = (x - x0) / dx
  const v = (y - y0) / dy
  if (!overlay.hasChildNodes()) {
    overlay.innerHTML = `<defs><linearGradient id="map-light"><stop stop-color="#131b29" stop-opacity=".38"/><stop offset="1" stop-color="#ffe2a3" stop-opacity=".23"/></linearGradient></defs>
      <rect id="map-lighting" width="512" height="512" fill="url(#map-light)"/>` + targets.map(target => `<g data-direction="${target}">
      <defs><marker id="tip-${target}" markerWidth="6" markerHeight="6" refX="8" refY="4" viewBox="0 0 8 8" orient="auto">
        <path d="M0 0L8 4L0 8Z" fill="${colors[target]}"/></marker></defs>
      <line x1="${u}" y1="${v}" stroke="${colors[target]}" stroke-width="2.5" marker-end="url(#tip-${target})"/>
      <g class="direction-tip">
      <text x="0" y="-11" text-anchor="middle" fill="${colors[target]}">${names[target]}</text></g>
      </g>`).join('') + `<circle cx="${u}" cy="${v}" r="5" fill="white" stroke="#17212a" stroke-width="2"/>`
  }
  const [sunAzimuth] = directionAt(observations,'Sun',position)
  const [lightX,lightY] = gridDirection(metadata.longitude_latitude_deg[0],sunAzimuth)
  const gradient = overlay.querySelector('#map-light')!
  gradient.setAttribute('x1',String(.5-lightX*.5))
  gradient.setAttribute('x2',String(.5+lightX*.5))
  gradient.setAttribute('y1',String(.5+lightY*.5))
  gradient.setAttribute('y2',String(.5-lightY*.5))
  overlay.querySelector('#map-lighting')!.setAttribute('fill',observations.Sun[Number(hour.value)][3] ? 'url(#map-light)' : '#11182768')
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
    const blocked = !observations[target][Number(hour.value)][3]
    line.setAttribute('stroke-dasharray',blocked ? '4 3' : 'none')
    group.querySelector('.direction-tip')!.setAttribute('transform',
      `translate(${tipX+20*east} ${tipY-20*north})`)
  }
}

function visibility(value: boolean) {
  return value ? '<strong class="yes">Visible</strong>' : '<strong class="no">Obscured</strong>'
}

function setDetailMode(mode: DetailMode) {
  workspace.dataset.detail = mode
  modeButtons.simple.setAttribute('aria-pressed',String(mode==='simple'))
  modeButtons.expert.setAttribute('aria-pressed',String(mode==='expert'))
  updateViewHelp()
  syncTerrain()
  render()
}

function render() {
  if (!current) return
  const i = Number(hour.value)
  const { observations, scenario } = current
  const samplesPerDay = 1440/scenario.step_min
  const time = observations.times[i]
  dayRange.value = String(Math.floor(i/samplesPerDay))
  dayTime.max = String(Math.min(samplesPerDay-1,observations.times.length-1-Math.floor(i/samplesPerDay)*samplesPerDay))
  dayTime.value = String(i%samplesPerDay)
  dayTime.setAttribute('aria-valuetext', time.slice(11)+' UTC')
  dayRange.setAttribute('aria-valuetext', time.slice(0,10))
  element('date').textContent = `· ${time} UTC`
  element('mission-date').textContent = `${time} UTC`
  const expert = workspace.dataset.detail==='expert'
  if (expert && analysis.open && analyzed!==observations) {
    renderAnalysis(observations,current.analysis,selectHour)
    analyzed=observations
  }
  element('comparison').innerHTML = targets.map(target => {
    const sample = observations[target][i]
    const [azimuth,elevation,horizon,visible] = sample
    const terrainUsed = observations.terrainUsed
    if (!expert) {
      const label = target==='Sun' ? 'Potential sunlight' : 'Geometric Earth visibility'
      const state = visible ? target==='Sun'?'Available':'Visible' : target==='Sun'?'In shadow':'Hidden'
      return `<div class="condition-card">
        <h3 style="color:${colors[target]}">${label}</h3>
        <strong class="${visible?'yes':'no'}">${state}</strong>
        <p>${explainVisibility(target,visible,terrainUsed)}</p>
        </div>`
    }
    return `<div class="object">
      <div class="body-head"><h3 style="color:${colors[target]}">${names[target]}</h3><small>AZ ${azimuth.toFixed(2)}° · EL ${elevation.toFixed(2)}°</small></div>
      <div class="row"><span>${terrainUsed?'Terrain':'Level'} horizon · ${horizon.toFixed(2)}°</span>${visibility(visible)}</div>
      </div>`
  }).join('') + `<p class="caption">Sun and Earth together · ${observations.bothVisible[i]?'Visible':'Unavailable at this time'}</p>`
  if (settings.dataset.mode==='system') renderSystemReadout()
  drawDirections()
}

function setView(next: View) {
  view = next
  element('terrain-tools').hidden = next!=='terrain'
  element('terrain-caption').hidden = next!=='terrain'
  element('surface-tools').hidden = next!=='surface'
  element('map-sky').hidden = next!=='map' || !current?.metadata
  if (next!=='map') mapSky = undefined
  element('map-readouts').hidden = next!=='map'
  element('map-layer-controls').hidden = next!=='map'
  for (const name of ['map','terrain','sky','surface'] as const) {
    element(name+'-view').hidden = name!==next
    element(name+'-button').setAttribute('aria-pressed',String(name===next))
  }
  if (next!=='terrain') { terrain?.dispose();terrain=undefined }
  if (next!=='sky'&&next!=='surface') sky=undefined
  updateViewHelp()
}

function updateViewHelp() {
  const expert = workspace.dataset.detail==='expert'
  element('view-help').textContent = {
    map:expert?'Map top is grid +Y':'View the landing site from above',
    terrain:'Drag to orbit · Click the terrain to see the sky from the landing marker',
    sky:expert?'Sun and Earth move in azimuth and altitude as time advances':'Press Play to see the Sun and Earth move across the sky',
    surface:'Drag or use the arrow keys to look around the landing site',
  }[view]
}

function showMap() {
  setView('map')
  if (current?.metadata) mapSky = createSky(element('map-sky'),false,current.observations,current.horizon,Number(hour.value),'map-sky')
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
    const model = data.metadata
      ? { metadata:data.metadata, grid:module.decodeTerrain(await loadHeights(data),data.metadata) }
      : await module.loadSiteTerrain(data.site,siteLoading?.signal)
    if (request !== revision) return
    terrainView.replaceChildren()
    terrain = module.createTerrain(terrainView, model.metadata, model.grid, data.site.name, () => openSky(true))
    const caption = element('terrain-caption')
    caption.classList.remove('expert-only')
    caption.textContent = model.grid.flat ? 'Terrain: none. Showing a level surface.' : 'Tracks show apparent positions over the selected observation period. Body sizes and distances are illustrative. Terrain shadows use the displayed relief. Mission conditions refer to the landing point.'
    syncTerrain()
    render()
  } catch (error) {
    if (request !== revision) return
    openSky()
    status.textContent = '3D terrain is unavailable. You can still explore the sky.'
    console.error(error)
  }
}

function syncTerrain() {
  const expert = workspace.dataset.detail==='expert'
  terrain?.style(expert ? Number(exaggeration.value) : 1,expert && wireframe.checked,directions.checked)
}

function refreshCoverage(reset: boolean) {
  const selected = catalogue.find(item=>item.id===site.value)
  if (!selected) return
  const from = Date.parse(selected.data_from ?? '')
  const to = Date.parse(selected.data_to ?? '')
  const available = Number.isFinite(from) && Number.isFinite(to)
  startDate.min = available ? dateOnly(from) : ''
  startDate.max = available ? dateOnly(to-dayMs) : ''
  if (reset) {
    startDate.value = available
      ? dateOnly(Math.max(Math.ceil(from/dayMs)*dayMs,Math.min(to-dayMs,Date.parse(defaultStart))))
      : defaultStart.slice(0,10)
    terrainInput.checked = selected.has_terrain
  }
  terrainInput.disabled = !selected.has_terrain
  const remaining = Math.floor((to-Date.parse(startDate.value))/dayMs)
  const stepLimit = Math.floor(5000*Number(stepSelect.value)/1440)
  daysInput.max = String(available ? Math.max(1,Math.min(remaining,stepLimit)) : stepLimit)
  if (reset) daysInput.value = String(Math.min(30,Number(daysInput.max)))
  element('coverage').textContent = available
    ? `Coverage · ${selected.data_from!.replace('T',' ').replace('Z','')} to ${selected.data_to!.replace('T',' ').replace('Z','')} UTC`
    : 'No observation range is available for this site.'
}

function clearComparison() {
  comparisonLoading?.abort()
  comparisonLoading = undefined
  shiftResults.replaceChildren()
  shiftStatus.textContent = ''
  for (const button of shiftButtons) button.disabled = true
}

function reportSource(demo: boolean, offline: boolean) {
  demoSeen ||= demo
  element('demo-banner').hidden = !demoSeen
  element('offline-banner').hidden = !offline
}

async function selectSite() {
  const selected = catalogue.find(item=>item.id===site.value)
  if (!selected) return
  const scenario: Scenario = {
    site_id:selected.id, start:startDate.value+'T00:00:00Z',days:Number(daysInput.value),
    step_min:Number(stepSelect.value),use_terrain:terrainInput.checked && selected.has_terrain,
  }
  if (!startDate.value || !Number.isInteger(scenario.days) || scenario.days<1 ||
      scenario.days*1440/scenario.step_min>5000) {
    status.textContent = 'Choose a start date and a duration of no more than 5,000 observations.'
    return
  }

  stopPlayback()
  const previous = current
  const previousTime = previous?.observations.times[Number(hour.value)]
  const previousView = view
  siteLoading?.abort()
  const loader = new AbortController()
  siteLoading = loader
  ++revision
  current = undefined
  mapSky = undefined
  playButton.disabled = hour.disabled = true
  dayRange.disabled = dayTime.disabled = true
  analyzeButton.disabled = true
  if (settings.dataset.mode==='system') renderSystemReadout()
  clearComparison()
  setView('map')
  resetMap()
  for (const id of ['site-facts','comparison','timeline','mission-metrics']) element(id).replaceChildren()
  overlay.replaceChildren()
  map.removeAttribute('src')
  element('date').textContent = ''
  element('mission-date').textContent = ''
  element('height-range').textContent = ''
  element('scale-label').textContent = ''
  element('map-sample').textContent = ''
  element('active-site').textContent = selected.name
  reportSource(selected.data_source==='synthetic_demo',catalogueOffline)
  status.textContent = 'Loading scenario…'
  const url = asset(selected.id)
  try {
    const [data, metadata] = await Promise.all([
      loadScenario(scenario,url,loader.signal),
      readJson<Metadata>(url+'metadata.json',loader.signal).catch(()=>undefined),
    ])
    if (loader.signal.aborted) return
    current = {...data,site:selected,scenario,url,metadata}
    const { observations } = data
    hour.max = String(observations.times.length-1)
    hour.value = String(Math.max(0,observations.times.indexOf(previousTime ?? '')))
    visualHour = Number(hour.value)
    dayRange.max = String(Math.floor((observations.times.length-1)/(1440/scenario.step_min)))
    hour.disabled = playButton.disabled = false
    dayRange.disabled = dayTime.disabled = false
    mapButton.disabled = !metadata
    if (metadata) map.src = url+layer.value
    element('period-start').textContent = observations.times[0].slice(0,10)
    element('period-end').textContent = observations.times.at(-1)!.slice(0,10)
    element('site-facts').innerHTML = `<dt>Latitude / longitude</dt><dd>${selected.lat.toFixed(4)}° / ${selected.lon.toFixed(4)}°</dd>
      <dt>Terrain elevation</dt><dd>${metadata?.ground_m===undefined?'—':metadata.ground_m.toFixed(1)+' m'}</dd>
      <dt>Reference frame</dt><dd>${metadata?'MOON_ME / DE421':'—'}</dd>
      <dt>Sky observations</dt><dd>${data.demo?'Synthetic demo':data.offline?'JPL Horizons · offline snapshot':'JPL Horizons · API'}</dd>`
    if (metadata) {
      const height = metadata.heightmaps['512']
      element('height-range').textContent = `${height.min_m.toFixed(0)} — ${(height.min_m+65534*height.step_m).toFixed(0)} m`
      element('map-sample').textContent = 'Move over the map to sample elevation'
    }
    showMetrics(metrics,data.analysis)
    reportSource(data.demo,data.offline || catalogueOffline)
    for (const button of shiftButtons) button.disabled = data.offline || catalogueOffline
    status.textContent = ''
    if (settings.dataset.mode==='terrain' && previousView==='terrain') void openTerrain()
    else if (settings.dataset.mode==='terrain' && (previousView!=='map' || !metadata)) openSky(previousView==='surface')
    else if (settings.dataset.mode==='terrain') showMap()
    else render()
  } catch (error) {
    if (!loader.signal.aborted) status.textContent = errorMessage(error)
  } finally {
    if (!loader.signal.aborted) analyzeButton.disabled = false
  }
}

function chooseSite(reset: boolean) {
  systemSite.value = site.value
  refreshCoverage(reset)
  return selectSite()
}

async function missionShift(shift: number) {
  if (!current || current.offline || catalogueOffline) return
  const a = current.scenario
  const b = {...a,start:new Date(Date.parse(a.start)+dayMs*shift).toISOString().replace('.000Z','Z')}
  clearComparison()
  const loader = new AbortController()
  comparisonLoading = loader
  shiftStatus.textContent = 'Comparing scenarios…'
  try {
    const data = await requestAPI<Comparison>('compare',loader.signal,{a,b})
    if (loader.signal.aborted) return
    reportSource([data.a.data_source,data.b.data_source].includes('synthetic_demo'),catalogueOffline)
    showComparison(shiftResults,data,shift)
    shiftStatus.textContent = ''
  } catch (error) {
    if (!loader.signal.aborted) shiftStatus.textContent = errorMessage(error)
  } finally {
    if (!loader.signal.aborted) for (const button of shiftButtons) button.disabled = false
  }
}

mapButton.addEventListener('click', () => {
  if (!current?.metadata) return
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
for (const button of shiftButtons) button.onclick = () => void missionShift(Number(button.dataset.shift))
startDate.onchange = stepSelect.onchange = () => refreshCoverage(false)
element<HTMLFormElement>('scenario-form').onsubmit = event => {
  event.preventDefault()
  void selectSite()
}
const selectDayTime = () => {
  if (current) selectHour(Number(dayRange.value)*1440/current.scenario.step_min+Number(dayTime.value))
}
dayRange.oninput = dayTime.oninput = selectDayTime
site.addEventListener('change', () => {
  ++navigation
  entering = false
  overview.classList.remove('travelling')
  void chooseSite(true)
  const selected = catalogue.find(item=>item.id===site.value)
  if (selected && settings.dataset.mode === 'globe') void globe.then(world => world?.focus(selected,false))
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
    visualHour = Math.min(last,visualHour+(now-previous)*Number(playSpeed.value)*60/(1000*current!.scenario.step_min))
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
layer.addEventListener('change', () => {
  if (current?.metadata) map.src = current.url+layer.value
  element('height-legend').hidden = layer.value!=='elevation.webp'
})
for (const input of [exaggeration,wireframe,directions]) input.addEventListener('change', () => { syncTerrain();render() })
element('terrain-in').onclick = () => terrain?.zoom(.8)
element('terrain-out').onclick = () => terrain?.zoom(1.25)
element('terrain-reset').onclick = () => terrain?.reset()
element('map-stage').addEventListener('pointerenter', () => {
  if (current?.metadata) void loadHeights(current).catch(() => {})
})
element('map-stage').addEventListener('pointermove', event => {
  if (!current?.metadata) return
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
const startup = new AbortController()
const sitesReady = loadSites(startup.signal)
const globe = Promise.all([import('./globe'),sitesReady]).then(([module,result]) =>
  module.createGlobe(element('moon-globe'),element('moon-catalog-items'),result.sites,enterSite)).catch(error => {
  element('moon-globe').textContent = 'The globe is unavailable. Use Explore terrain to open the site.'
  element('moon-catalog').hidden = true
  console.error(error)
  return undefined
})
let lunarGlobe: Awaited<typeof globe>
const floatingToggle = element<HTMLButtonElement>('globe-floating')
void globe.then(world => {
  if (!world) return
  lunarGlobe = world
  if (settings.dataset.mode==='globe') drawDirections()
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
  element('orbit-coverage').hidden = true
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
  else if (current?.metadata) map.src=current.url+layer.value
  else if (current) openSky()
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

function renderSystemReadout() {
  const rows = element('system-coordinates')
  const summary = element('system-visibility')
  rows.replaceChildren()
  summary.hidden = true
  if (!current || !selectedBody) return
  const sample = current.observations[selectedBody][Number(hour.value)]
  summary.textContent = explainVisibility(selectedBody,sample[3],current.observations.terrainUsed)
  summary.hidden = false
  rows.innerHTML = `<div><dt>Azimuth</dt><dd>${sample[0].toFixed(2)}°</dd></div>
    <div><dt>Elevation</dt><dd>${sample[1].toFixed(2)}°</dd></div>
    <div><dt>Horizon visibility</dt><dd>${sample[3]?'Visible':'Obscured'}</dd></div>`
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
  renderSystemReadout()
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
  void chooseSite(true)
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
  if (mode==='globe') drawDirections()
}

async function enterSite(selected: Site) {
  if (entering) return
  entering = true
  const request = ++navigation
  const changed = site.value!==selected.id
  site.value = selected.id
  const ready = (changed || !current ? chooseSite(changed) : Promise.resolve()).then(()=>current?.site.id===selected.id)

  const world = await Promise.race([globe, new Promise<undefined>(resolve => setTimeout(resolve, 1200))])
  if (request !== navigation) return
  const [, loaded] = await Promise.all([world?.focus(selected), ready])
  if (request !== navigation) return
  if (!loaded) {
    entering = false
    world?.reset()
    if (!status.textContent) status.textContent = 'The scenario could not be loaded.'
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

element('explore').onclick=()=>{
  const selected = catalogue.find(item=>item.id===site.value)
  if (selected) void enterSite(selected)
}
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

let initialDetail: DetailMode = 'simple'
try {
  if (localStorage.getItem(detailPreference)==='expert') initialDetail = 'expert'
} catch { /* The switch remains usable without storage. */ }
setDetailMode(initialDetail)
for (const mode of ['simple','expert'] as const) {
  modeButtons[mode].onclick = () => {
    setDetailMode(mode)
    try { localStorage.setItem(detailPreference,mode) } catch { /* Still usable. */ }
  }
}
status.textContent = 'Loading landing sites…'
void sitesReady.then(({sites,offline}) => {
  catalogue = sites
  catalogueOffline = offline
  reportSource(false,offline)
  for (const select of [site,systemSite]) {
    select.replaceChildren(...sites.map(item=>new Option(item.name,item.id)))
  }
  const first = sites.find(item=>item.data_from) ?? sites[0]
  if (!first) { status.textContent = 'The API returned no landing sites.'; return }
  site.value = first.id
  void chooseSite(true)
}).catch(error => { status.textContent = errorMessage(error) })
