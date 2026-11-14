import { renderAnalysis, updateAnalysisCursor } from './analysis'
import { createSky } from './sky-view'
import { readJson } from './model'
import type { Metadata, Observations, Site } from './model'
import type { Analysis, Horizon } from './sky-data'
import type { createTerrain } from './terrain'

interface ComparisonViewData {
  observations: Observations
  horizon: Horizon
  analysis: Analysis
  site: Site
  url: string
}

type View = 'sky' | 'map' | 'terrain' | 'surface'

export function showComparisonViews(host: HTMLElement, scenarios: ComparisonViewData[], stepMinutes: number) {
  host.innerHTML = `
    <div class="comparison-stages">
      <section class="comparison-panel"></section>
      <section class="comparison-panel"></section>
    </div>
    <div class="comparison-view-controls">
      <button type="button" data-play>Play</button>
      <label>Speed <select data-speed><option value="6">6 h/s</option><option value="12" selected>12 h/s</option></select></label>
      <label class="comparison-time">Elapsed time <input type="range" min="0" value="0"></label>
    </div>
    <div class="comparison-charts">
      <section><h4>Scenario A</h4><div class="site-analysis"></div></section>
      <section><h4>Scenario B</h4><div class="site-analysis"></div></section>
    </div>`
  const slider = host.querySelector<HTMLInputElement>('input[type=range]')!
  const play = host.querySelector<HTMLButtonElement>('[data-play]')!
  const speed = host.querySelector<HTMLSelectElement>('[data-speed]')!
  const charts = Array.from(host.querySelectorAll<HTMLElement>('.site-analysis'))
  const last = scenarios[0].observations.times.length - 1
  slider.max = String(last)
  let index = 0
  let frame = 0
  const panels = Array.from(host.querySelectorAll<HTMLElement>('.comparison-panel'), (panel, i) =>
    createPanel(panel, scenarios[i], i === 0 ? 'A' : 'B', i === 0 ? 'sky' : 'map', () => index))

  function stop() {
    cancelAnimationFrame(frame)
    frame = 0
    play.textContent = 'Play'
  }

  function update() {
    const sample = Math.floor(index)
    slider.value = String(sample)
    slider.setAttribute('aria-valuetext', `${sample * stepMinutes / 60} hours elapsed`)
    panels.forEach(panel => panel.update())
    charts.forEach((chart, i) => updateAnalysisCursor(chart, scenarios[i].observations, index))
  }

  function seek(sample: number) {
    stop()
    index = sample
    update()
  }

  slider.oninput = () => seek(Number(slider.value))
  play.disabled = last === 0
  play.onclick = () => {
    if (frame) { stop(); return }
    if (index >= last) seek(0)
    play.textContent = 'Pause'
    let previous = performance.now()
    const advance = (now: number) => {
      index = Math.min(last, index + (now-previous)*Number(speed.value)*60/(1000*stepMinutes))
      previous = now
      update()
      if (index < last) frame = requestAnimationFrame(advance)
      else stop()
    }
    frame = requestAnimationFrame(advance)
  }
  charts.forEach((chart, i) => renderAnalysis(chart, scenarios[i].observations, scenarios[i].analysis, seek, true))
  update()
  return () => { stop(); panels.forEach(panel => panel.dispose()) }
}

function createPanel(panel: HTMLElement, data: ComparisonViewData, scenario: 'A' | 'B', initial: View, position: () => number) {
  panel.innerHTML = `
    <h4></h4>
    <label>View <select aria-label="Scenario ${scenario} view">
      <option value="sky">2D Sky</option>
      <option value="map">2D Map</option>
      <option value="terrain">3D Terrain</option>
      <option value="surface">Surface View</option>
    </select></label>
    <output class="caption"></output>
    <div class="comparison-stage"></div>`
  panel.querySelector('h4')!.textContent = `Scenario ${scenario} · ${data.site.name}`
  const picker = panel.querySelector('select')!
  const stage = panel.querySelector<HTMLElement>('.comparison-stage')!
  const clock = panel.querySelector('output')!
  let sky: ReturnType<typeof createSky> | undefined
  let terrain: ReturnType<typeof createTerrain> | undefined
  let pending: AbortController | undefined

  function update() {
    const index = position()
    const sample = Math.floor(index)
    clock.textContent = data.observations.times[sample] + ' UTC'
    sky?.update(index, sample, true)
    terrain?.update(data.observations, index)
  }

  function releaseView() {
    pending?.abort()
    terrain?.dispose()
    terrain = undefined
    sky = undefined
    stage.replaceChildren()
  }

  async function draw(view: View) {
    releaseView()
    picker.value = view
    const scene = document.createElement('div')
    stage.append(scene)
    if (view === 'sky' || view === 'surface') {
      scene.className = 'sky-view'
      sky = createSky(scene, view === 'surface', data.observations, data.horizon, Math.floor(position()), `comparison-sky-${scenario}`)
    } else if (view === 'map') {
      const map = document.createElement('img')
      map.className = 'comparison-map'
      map.alt = `2D terrain map of ${data.site.name}`
      map.onerror = () => { scene.textContent = '2D map is unavailable for this site.' }
      scene.append(map)
      map.src = data.url + 'hillshade.webp'
    } else {
      scene.className = 'viewport comparison-terrain'
      const note = document.createElement('p')
      note.className = 'caption'
      note.textContent = 'Loading 3D terrain…'
      stage.append(note)
      const loader = new AbortController()
      pending = loader
      try {
        const module = await import('./terrain')
        if (loader.signal.aborted) return
        const metadata = await readJson<Metadata>(data.url+'metadata.json', loader.signal).catch(() => undefined)
        const model = metadata ? await (async () => {
          const response = await fetch(data.url+'terrain-512.bin', { signal:loader.signal })
          if (!response.ok) throw new Error('Terrain grid unavailable')
          const buffer = await response.arrayBuffer()
          if (buffer.byteLength !== 512*512*2) throw new Error('Invalid terrain grid')
          return { metadata, grid:module.decodeTerrain(new DataView(buffer),metadata) }
        })() : await module.loadSiteTerrain(data.site, loader.signal)
        if (loader.signal.aborted) return
        terrain = module.createTerrain(scene, model.metadata, model.grid, data.site.name, () => void draw('surface'))
        note.textContent = model.grid.flat ? 'Terrain unavailable. Showing a level surface.' : 'Drag to orbit · Scroll to zoom · Click the landing marker for the surface view'
      } catch {
        if (loader.signal.aborted) return
        scene.remove()
        note.textContent = '3D terrain is unavailable for this site.'
      }
    }
    update()
  }

  picker.onchange = () => void draw(picker.value as View)
  void draw(initial)
  return { update, dispose: releaseView }
}
