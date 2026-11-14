import { metricLabels } from './sky-data'
import type { Analysis, Comparison } from './sky-data'

function metricCards(data: Analysis) {
  return Object.entries(metricLabels).map(([key,label])=>
    `<div class="mission-metric"><dt>${label}</dt><dd>${data[key as keyof typeof metricLabels]} h</dd></div>`
  ).join('')
}

function eventText(data: Analysis, body: 'sun'|'earth') {
  const sun = body==='sun'
  const name = sun?'Sun':'Earth'
  const status = sun?data.sun_status:data.earth_status
  const set = sun?data.time_to_sunset_h:data.time_to_earth_set_h
  const rise = sun?data.time_to_sunrise_h:data.time_to_earth_rise_h
  switch (status) {
    case 'up_until_set': return set===null?'Time unavailable':`${sun?'Sunset':'Earthset'} in ${set} h`
    case 'down_until_rise': return rise===null?'Time unavailable':`${sun?'Sunrise':'Earthrise'} in ${rise} h`
    case 'up_all_period': return `${name} stays visible for the entire period`
    case 'down_all_period': return `${name} stays below the horizon for the entire period`
    default: return 'Event data unavailable'
  }
}

export function showMetrics(host: HTMLElement, data: Analysis) {
  const windows = [
    ['Potential sunlight',data.light_windows],
    ['Geometric Earth visibility',data.earth_windows],
    ['Sun and Earth visible together',data.both_windows],
  ] as const
  const format = (time:string) => new Date(time).toISOString().slice(0,16).replace('T',' ')+' UTC'
  host.innerHTML = `<p class="caption">Period · ${data.period_hours} h · ${data.terrain_used?'Terrain horizon':'Level horizon'}</p>
    <dl class="mission-metrics">${metricCards(data)}</dl>
    <p>${eventText(data,'sun')} · ${eventText(data,'earth')}</p>
    <p class="caption">Times to rise or set are measured from the scenario start.</p>
    <div class="mission-windows">${windows.map(([label,items])=>`<details><summary>${label} windows (${items.length})</summary>
      ${items.length?`<ul>${items.map(window=>`<li>${format(window.from)} – ${format(window.to)}</li>`).join('')}</ul>`:'<p>No windows in this period.</p>'}</details>`).join('')}</div>`
}

export function showComparison(host: HTMLElement, data: Comparison, shift: number) {
  const date = (time: string) => time.slice(0,10)+' UTC'
  host.innerHTML = `<h3>Mission Shift · +${shift} days</h3>
    <div class="comparison-grid">
      <div><h4>Scenario A · ${date(data.a.start)}</h4><dl>${metricCards(data.a)}</dl></div>
      <div><h4>Scenario B · ${date(data.b.start)}</h4><dl>${metricCards(data.b)}</dl></div>
      <div><h4>Difference (B − A)</h4><dl>${Object.entries(metricLabels).map(([key,label])=>{
        const value=data.delta[key as keyof typeof metricLabels]
        return `<div class="mission-metric"><dt>${label}</dt><dd>${value>0?'+':''}${value} h</dd></div>`
      }).join('')}</dl></div>
    </div><p id="shift-summary"></p>`
  host.querySelector('#shift-summary')!.textContent=data.summary
}
