import './style.css'
import { renderAnalysis, updateAnalysisCursor } from './analysis'
import { createSky } from './sky-view'
import { assetFolder, dayMs, loadScenario, loadSites, parseObservations, requestAPI } from './sky-data'
import type { Comparison, Scenario, TimeSeries } from './sky-data'
import { showComparisonViews } from './comparison-views'
import { showComparison, showMetrics } from './mission'
import { countdownHtml, describe } from './countdown'
import { num } from './format'
import { mapNavigation } from './map-navigation'
import { colors, directionAt, explainVisibility, gridDirection, lunarDirection, names, readJson, targets } from './model'
import type { Metadata, Observations, Site, TerrainGrid } from './model'
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
const shiftInput = element<HTMLInputElement>('shift-custom')
const shiftInputError = element('shift-input-error')
const shiftRange = element('shift-range')
const shiftButtons = document.querySelectorAll<HTMLButtonElement>('[data-shift],[data-shift-custom]')
const metrics = element('mission-metrics')
const shiftResults = element('shift-results')
const shiftStatus = element('shift-status')
const siteCompareForm = element<HTMLFormElement>('site-compare-form')
const siteComparePanels = ['compare-a', 'compare-b'].map(id => {
  const panel = element<HTMLFieldSetElement>(id)
  return {
    panel,
    site: panel.querySelector<HTMLSelectElement>('select[name="site"]')!,
    start: panel.querySelector<HTMLInputElement>('input[name="start"]')!,
    terrain: panel.querySelector<HTMLInputElement>('input[name="terrain"]')!,
  }
})
const compareSitesButton = element<HTMLButtonElement>('compare-sites')
const siteCompareStatus = element('site-compare-status')
const siteCompareResults = element('site-compare-results')
const siteCompareVisuals = element('site-compare-visuals')
let disposeComparisonViews: (() => void) | undefined
let siteComparisonLoading: AbortController | undefined
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

// The 3D mesh uses the 1024 grid (about 5 m, the source resolution); the 512 grid is the fallback.
async function loadMesh(data: Data, decode: (view: DataView, metadata: Metadata, size?: number) => TerrainGrid) {
  const metadata = data.metadata!
  try {
    if (!metadata.heightmaps['1024']) throw new Error('No 1024 grid')
    const response = await fetch(data.url+'terrain-1024.bin', { signal: siteLoading?.signal })
    const buffer = response.ok ? await response.arrayBuffer() : undefined
    if (buffer?.byteLength !== 1024*1024*2) throw new Error('Invalid 1024 grid')
    return { metadata, grid: decode(new DataView(buffer), metadata, 1024) }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    return { metadata, grid: decode(await loadHeights(data), metadata, 512) }
  }
}

function renderScale() {
  if (!current?.metadata || !mapPixels) return
  const pixelMeters = current.metadata.heightmaps['512'].affine[0]*512/mapPixels
  const limit = pixelMeters*95
  const decade = 10**Math.floor(Math.log10(limit))
  const length = ([5,2,1].find(n=>n*decade<=limit) ?? 1)*decade
  element('scale-line').style.width = `${length/pixelMeters}px`
  element('scale-label').textContent = length>=1000?`${num(length/1000)} km`:`${length} m`
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
  if (workspace.dataset.detail==='expert' && analysis.open) updateAnalysisCursor(element('timeline'),observations,visualHour)
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
  else sky?.update(index,Number(hour.value),true)
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
      <rect id="map-lighting" width="512" height="512" fill="url(#map-light)"/>` + `<circle cx="${u}" cy="${v}" r="5" fill="white" stroke="#17212a" stroke-width="2"/>`
  }
  const [sunAzimuth] = directionAt(observations,'Sun',position)
  const [lightX,lightY] = gridDirection(metadata.longitude_latitude_deg[0],sunAzimuth)
  const gradient = overlay.querySelector('#map-light')!
  gradient.setAttribute('x1',String(.5-lightX*.5))
  gradient.setAttribute('x2',String(.5+lightX*.5))
  gradient.setAttribute('y1',String(.5+lightY*.5))
  gradient.setAttribute('y2',String(.5-lightY*.5))
  overlay.querySelector('#map-lighting')!.setAttribute('fill',observations.Sun[Number(hour.value)][3] ? 'url(#map-light)' : '#11182768')

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
    renderAnalysis(element('timeline'),observations,current.analysis,selectHour)
    analyzed=observations
  }
  const step = scenario.step_min
  const countdowns = {
    Sun: describe(observations.Sun.map(row=>row[3]),i,step,
      {ending:'Sunset',starting:'Sunrise',stays:'Sun stays visible',stayed:'Sun stays below the horizon'}),
    Earth: describe(observations.Earth.map(row=>row[3]),i,step,
      {ending:'Earthset · geometric visibility ends',starting:'Earthrise · geometric visibility starts',stays:'Earth stays visible',stayed:'Earth stays hidden'}),
    both: describe(observations.bothVisible,i,step,
      {ending:'Sun and Earth together end',starting:'Sun and Earth together start',stays:'Sun and Earth stay visible together',stayed:'Sun and Earth are not visible together'}),
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
        <div class="countdown">${countdownHtml(countdowns[target])}</div>
        </div>`
    }
    return `<div class="object">
      <div class="body-head"><h3 style="color:${colors[target]}">${names[target]}</h3><small>AZ ${num(azimuth)}° · EL ${num(elevation)}°</small></div>
      <div class="row"><span>${terrainUsed?'Terrain':'Level'} horizon · ${num(horizon)}°</span>${visibility(visible)}</div>
      <div class="countdown">${countdownHtml(countdowns[target])}</div>
      </div>`
  }).join('') + `<p class="caption">Sun and Earth together · ${observations.bothVisible[i]?'Visible':'Unavailable at this time'}</p>
    <div class="caption countdown">${countdownHtml(countdowns.both)}</div>
    <p class="caption">Countdowns are counted from the observation time, from the ${step}-minute samples (accurate to one step).</p>`
  if (settings.dataset.mode==='system') renderSystemReadout()
  drawDirections()
}

function setView(next: View) {
  view = next
  element('sky-legend').hidden = next!=='sky' && next!=='surface'
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
      ? await loadMesh(data,module.decodeTerrain)
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
  terrain?.style(Number(exaggeration.value),expert && wireframe.checked)
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
  shiftStatus.classList.remove('shift-pending')
  for (const button of shiftButtons) button.disabled = true
  shiftInput.disabled = true
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
  clearSiteComparison()
  compareSitesButton.disabled = true
  for (const {panel} of siteComparePanels) panel.disabled = true
  element('site-compare-period').textContent = ''
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
      <dt>Terrain elevation</dt><dd>${metadata?.ground_m===undefined?'—':num(metadata.ground_m)+' m'}</dd>
      <dt>Reference frame</dt><dd>${metadata?'MOON_ME / DE421':'—'}</dd>
      <dt>Sky observations</dt><dd>${data.demo?'Synthetic demo':data.offline?'JPL Horizons · offline snapshot':'JPL Horizons · API'}</dd>`
    if (metadata) {
      const height = metadata.heightmaps['512']
      element('height-range').textContent = `${height.min_m.toFixed(0)} — ${(height.min_m+65534*height.step_m).toFixed(0)} m`
      element('map-sample').textContent = 'Move over the map to sample elevation'
    }
    showMetrics(metrics,data.analysis)
    reportSource(data.demo,data.offline || catalogueOffline)
    updateShiftControls()
    updateSiteComparison(current)
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

function clearSiteComparison() {
  siteComparisonLoading?.abort()
  siteComparisonLoading = undefined
  siteCompareStatus.textContent = ''
  siteCompareResults.replaceChildren()
  disposeComparisonViews?.()
  disposeComparisonViews = undefined
  siteCompareVisuals.replaceChildren()
}

function updateComparePanel(fields: typeof siteComparePanels[number], scenario: Scenario) {
  const selected = catalogue.find(candidate => candidate.id === fields.site.value)!
  fields.start.min = dateOnly(Math.ceil(Date.parse(selected.data_from!) / dayMs) * dayMs)
  fields.start.max = dateOnly(Date.parse(selected.data_to!) - scenario.days * dayMs)
  if (fields.start.value < fields.start.min || fields.start.value > fields.start.max) {
    fields.start.value = fields.start.min
  }
  fields.terrain.disabled = !selected.has_terrain
  if (fields.terrain.disabled) fields.terrain.checked = false
}

function updateSiteComparison(data: Data) {
  const { scenario } = data
  const options = catalogue.filter(candidate =>
    Date.parse(candidate.data_to ?? '') - Math.ceil(Date.parse(candidate.data_from ?? '') / dayMs) * dayMs >= scenario.days * dayMs,
  )
  const offline = data.offline || catalogueOffline
  const first = options.find(candidate => candidate.id === data.site.id) ?? options[0]
  const second = options.find(candidate => candidate.id !== first?.id) ?? first
  for (const [index, fields] of siteComparePanels.entries()) {
    fields.site.replaceChildren(...options.map(candidate => new Option(candidate.name, candidate.id)))
    fields.panel.disabled = offline || !options.length
    const selected = index === 0 ? first : second
    if (!selected) continue
    fields.site.value = selected.id
    fields.start.value = scenario.start.slice(0,10)
    fields.terrain.checked = scenario.use_terrain
    updateComparePanel(fields, scenario)
  }
  element('site-compare-period').textContent = `Shared period · ${scenario.days} days · ${scenario.step_min}-minute steps`
  compareSitesButton.disabled = offline || !options.length
  if (offline) siteCompareStatus.textContent = 'Site comparison requires a connection to the server.'
  else if (!options.length) siteCompareStatus.textContent = 'No site has data for the current period length.'
}

for (const fields of siteComparePanels) {
  fields.panel.oninput = event => {
    if (!current) return
    if (event.target === fields.site) updateComparePanel(fields, current.scenario)
    clearSiteComparison()
    compareSitesButton.disabled = false
  }
}

siteCompareForm.onsubmit = async event => {
  event.preventDefault()
  if (!current || compareSitesButton.disabled) return
  const scenario = current.scenario
  const [a, b] = siteComparePanels.map(fields => ({
    ...scenario,
    site_id: fields.site.value,
    start: fields.start.value + 'T00:00:00Z',
    use_terrain: fields.terrain.checked,
  }))
  const names = [
    `Scenario A · ${siteComparePanels[0].site.selectedOptions[0].text}`,
    `Scenario B · ${siteComparePanels[1].site.selectedOptions[0].text}`,
  ] as const
  clearSiteComparison()
  const loader = new AbortController()
  siteComparisonLoading = loader
  compareSitesButton.disabled = true
  siteCompareStatus.textContent = 'Comparing landing sites…'
  try {
    const [data, ...series] = await Promise.all([
      requestAPI<Comparison>('compare', loader.signal, {a,b}),
      requestAPI<TimeSeries>('timeseries', loader.signal, a),
      requestAPI<TimeSeries>('timeseries', loader.signal, b),
    ] as const)
    if (loader.signal.aborted) return
    reportSource([data.a.data_source,data.b.data_source].includes('synthetic_demo'), catalogueOffline)
    showComparison(siteCompareResults, data, names)
    disposeComparisonViews = showComparisonViews(siteCompareVisuals, [a,b].map((sc,index) => ({
      ...parseObservations(series[index], sc),
      analysis: index === 0 ? data.a : data.b,
      site: catalogue.find(candidate => candidate.id === sc.site_id)!,
      url: asset(sc.site_id),
    })), scenario.step_min)
    siteCompareStatus.textContent = ''
  } catch (error) {
    if (!loader.signal.aborted) siteCompareStatus.textContent = errorMessage(error)
  } finally {
    if (!loader.signal.aborted) {
      siteComparisonLoading = undefined
      compareSitesButton.disabled = false
    }
  }
}

// Dates (UTC, ms) covered by the data of the current site, from /api/sites.
function dataRange() {
  const from = Date.parse(current?.site.data_from ?? ''), to = Date.parse(current?.site.data_to ?? '')
  return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : undefined
}

function shiftLimits() {
  const range = dataRange()
  if (!current || !range) return
  const start = Date.parse(current.scenario.start)
  return {
    min:Math.ceil((range.from-start)/dayMs),
    max:Math.floor((range.to-start)/dayMs)-current.scenario.days,
  }
}

function shiftError(shift: number) {
  if (!Number.isInteger(shift) || shift===0) return 'Enter a whole number of days other than 0.'
  const limits = shiftLimits()
  if (!limits) return 'No data range is available for this site.'
  if (shift>=limits.min && shift<=limits.max) return ''
  const range = dataRange()!
  const start = Date.parse(current!.scenario.start)+dayMs*shift
  const end = start+dayMs*current!.scenario.days
  return Number.isFinite(new Date(start).getTime()) && Number.isFinite(new Date(end).getTime())
    ? `No data for a shift of ${shift>0?'+':'−'}${Math.abs(shift)} days: scenario B would cover ${dateOnly(start)} to ${dateOnly(end)}, `+
      `the data covers ${dateOnly(range.from)} to ${dateOnly(range.to)} UTC.`
    : 'This number is outside the available range.'
}

function updateShiftControls() {
  const limits = shiftLimits()
  const enabled = Boolean(current && !current.offline && !catalogueOffline && limits && (limits.min<0 || limits.max>0))
  shiftInput.disabled = !enabled || !!comparisonLoading
  shiftInput.min = limits ? String(limits.min) : ''
  shiftInput.max = limits ? String(limits.max) : ''
  shiftRange.textContent = enabled && limits
    ? `Allowed: ${limits.min} to ${limits.max} days (excluding 0)`
    : 'No shifts available.'
  const hasValue = shiftInput.value!=='' || shiftInput.validity.badInput
  const error = enabled && hasValue ? shiftError(shiftInput.valueAsNumber) : ''
  shiftInputError.textContent = error
  shiftInput.setCustomValidity(error)
  shiftInput.setAttribute('aria-invalid',String(Boolean(error)))
  for (const button of shiftButtons) {
    const preset = button.dataset.shift
    const blocked = preset!==undefined ? shiftError(Number(preset)) : error || !hasValue
    button.disabled = !enabled || !!comparisonLoading || Boolean(blocked)
    button.title = enabled && preset!==undefined ? String(blocked) : ''
  }
}

async function missionShift(shift: number) {
  if (!current || current.offline || catalogueOffline || comparisonLoading) return
  const a = current.scenario
  const error = shiftError(shift)
  if (error) {
    updateShiftControls()
    shiftStatus.textContent = error
    return
  }
  const start = Date.parse(a.start)+dayMs*shift
  const b = {...a,start:new Date(start).toISOString().replace('.000Z','Z')}
  clearComparison()
  const loader = new AbortController()
  comparisonLoading = loader
  shiftStatus.textContent = 'Comparing scenarios…'
  shiftStatus.classList.add('shift-pending')
  try {
    const data = await requestAPI<Comparison>('compare',loader.signal,{a,b})
    if (loader.signal.aborted) return
    reportSource([data.a.data_source,data.b.data_source].includes('synthetic_demo'),catalogueOffline)
    showComparison(shiftResults,data,shift)
    shiftStatus.textContent = ''
  } catch (error) {
    if (!loader.signal.aborted) shiftStatus.textContent = errorMessage(error)
  } finally {
    if (!loader.signal.aborted) {
      comparisonLoading = undefined
      shiftStatus.classList.remove('shift-pending')
      updateShiftControls()
    }
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
for (const button of shiftButtons) {
  button.onclick = () => void missionShift(button.dataset.shift!==undefined ? Number(button.dataset.shift) : Number(shiftInput.value||NaN))
}
shiftInput.addEventListener('input', updateShiftControls)
shiftInput.addEventListener('keydown', event => {
  if (event.key==='Enter') {
    event.preventDefault()
    updateShiftControls()
    if (shiftInput.value && shiftInput.validity.valid) void missionShift(shiftInput.valueAsNumber)
  }
})
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
for (const input of [exaggeration,wireframe]) input.addEventListener('change', () => { syncTerrain();render() })
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
  const z=code===undefined||code===info.nodata_code?'Data unavailable':`${num(info.min_m+(code-1)*info.step_m)} m`
  element('map-sample').textContent=`${lat.toFixed(4)}° / ${lon.toFixed(4)}° E · ${z}`
})
const overview = element('overview')
const settings = element('site-settings')
const observationTimeline = element('observation-timeline')
const timelineHome = document.createComment('Desktop timeline position')
observationTimeline.before(timelineHome)
const sceneStack = settings.querySelector('.scene-stack')!
const compactLayout = matchMedia('(max-width:630px)')
const mobileSections = [
  ['scenario-form','Analysis settings'],
  ['mission-summary','Scenario results and comparison'],
].map(([id,title]) => {
  const content = element(id)
  const disclosure = document.createElement('details')
  disclosure.className = 'mobile-disclosure panel'
  const summary = document.createElement('summary')
  summary.textContent = title
  disclosure.append(summary)
  return {content,disclosure}
})

const placeMobileControls = () => {
  if (compactLayout.matches) sceneStack.append(observationTimeline)
  else timelineHome.after(observationTimeline)

  for (const {content,disclosure} of mobileSections) {
    if (compactLayout.matches && content.parentElement!==disclosure) {
      content.before(disclosure)
      disclosure.append(content)
    } else if (!compactLayout.matches && content.parentElement===disclosure) {
      disclosure.replaceWith(content)
    }
  }
}
compactLayout.addEventListener('change', placeMobileControls)
placeMobileControls()
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

function syncFullscreen() {
  const active = document.fullscreenElement === workspace || workspace.classList.contains('expanded-workspace')
  const label = active ? 'Exit fullscreen' : 'Enter fullscreen'
  for (const button of fullscreenButtons) {
    button.setAttribute('aria-label', label)
    button.title = label
  }
  fullscreenButtons[0].textContent = active ? 'Exit fullscreen' : 'Fullscreen'
}

function setExpandedWorkspace(active: boolean) {
  workspace.classList.toggle('expanded-workspace',active)
  document.body.classList.toggle('workspace-expanded',active)
  syncFullscreen()
}

async function toggleFullscreen() {
  if (workspace.classList.contains('expanded-workspace')) {
    setExpandedWorkspace(false)
    return
  }
  if (document.fullscreenElement === workspace) {
    await document.exitFullscreen()
    return
  }
  if (document.fullscreenEnabled && workspace.requestFullscreen) {
    try {
      await workspace.requestFullscreen()
      return
    } catch { /* Embedded browsers may reject native fullscreen. */ }
  }
  setExpandedWorkspace(true)
}

for (const button of fullscreenButtons) button.onclick = toggleFullscreen
document.addEventListener('fullscreenchange',syncFullscreen)
document.addEventListener('keydown', event => {
  if (event.key==='Escape' && workspace.classList.contains('expanded-workspace')) setExpandedWorkspace(false)
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
  rows.innerHTML = `<div><dt>Azimuth</dt><dd>${num(sample[0])}°</dd></div>
    <div><dt>Elevation</dt><dd>${num(sample[1])}°</dd></div>
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
  if (world && !reducedMotion && typeof overview.animate==='function') {
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
