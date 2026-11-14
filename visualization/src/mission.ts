import { metricLabels } from './sky-data'
import type { Analysis, Comparison } from './sky-data'
import { formatWindow } from './countdown'
import { num } from './format'

function metricCards(data: Analysis) {
  return Object.entries(metricLabels).map(([key,label])=>
    `<div class="mission-metric"><dt>${label}</dt><dd>${num(data[key as keyof typeof metricLabels])} h</dd></div>`
  ).join('')
}

export function showMetrics(host: HTMLElement, data: Analysis) {
  const windows = [
    ['Potential sunlight',data.light_windows],
    ['Geometric Earth visibility',data.earth_windows],
    ['Sun and Earth visible together',data.both_windows],
  ] as const
  host.innerHTML = `<p class="caption">Period · ${num(data.period_hours)} h · ${data.terrain_used?'Terrain horizon':'Level horizon'}</p>
    <dl class="mission-metrics">${metricCards(data)}</dl>
    <p class="caption">Windows · all times UTC</p>
    <div class="mission-windows">${windows.map(([label,items])=>`<details><summary>${label} windows (${items.length})</summary>
      ${items.length?`<ul>${items.map(window=>`<li>${formatWindow(window.from,window.to)}</li>`).join('')}</ul>`:'<p>No windows in this period.</p>'}</details>`).join('')}</div>`
}

export function showComparison(host: HTMLElement, data: Comparison, shift: number) {
  const date = (time: string) => time.slice(0,10)+' UTC'
  host.innerHTML = `<h3>Mission Shift · ${shift>0?'+':'−'}${Math.abs(shift)} days</h3>
    <div class="comparison-grid">
      <div><h4>Scenario A · ${date(data.a.start)}</h4><dl>${metricCards(data.a)}</dl></div>
      <div><h4>Scenario B · ${date(data.b.start)}</h4><dl>${metricCards(data.b)}</dl></div>
      <div><h4>Difference (B − A)</h4><dl>${Object.entries(metricLabels).map(([key,label])=>{
        const value=data.delta[key as keyof typeof metricLabels]
        return `<div class="mission-metric"><dt>${label}</dt><dd>${value>0?'+':''}${num(value)} h</dd></div>`
      }).join('')}</dl></div>
    </div><p id="shift-summary"></p>`
  host.querySelector('#shift-summary')!.textContent=data.summary
}
